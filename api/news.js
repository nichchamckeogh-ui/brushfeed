export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const topics = (req.query.topics || 'AI,Health').split(',');
  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  // 2 weeks ago
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  // Simple broad query per topic — let Claude do the smart filtering
  const topicQueries = {
    AI:        'artificial intelligence',
    Parenting: 'parenting children',
    Health:    'health medical',
    Money:     'personal finance',
    Science:   'science research',
    World:     'world news international',
  };

  // What each topic actually means — Claude uses this to filter
  const topicDefinitions = {
    AI:        'artificial intelligence, machine learning, AI models, ChatGPT, OpenAI, Google AI, robotics, AI regulation, AI safety, large language models',
    Parenting: 'parenting advice, child development, babies, toddlers, kids education, screen time, child psychology, family health, teenage wellbeing',
    Health:    'medical research, health studies, nutrition, mental health, exercise science, new treatments, clinical trials, wellness, disease prevention',
    Money:     'personal finance, saving money, investing, budgeting, interest rates, mortgages, cost of living, inflation, pensions, salary',
    Science:   'scientific discoveries, space exploration, climate science, biology, physics, chemistry, genetics, NASA, research breakthroughs',
    World:     'international news, geopolitics, global economy, foreign policy, world leaders, diplomacy, international relations, global conflicts',
  };

  try {
    // Step 1: Fetch up to 100 articles per topic from NewsAPI — minimal filtering
    const allHeadlines = [];

    for (const topic of topics) {
      const query = topicQueries[topic] || topic;

      const newsRes = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=100&language=en&from=${twoWeeksAgo}&apiKey=${NEWS_API_KEY}`
      );
      const newsData = await newsRes.json();

      if (newsData.articles) {
        newsData.articles
          // Only remove completely empty or deleted articles
          .filter(a =>
            a.title &&
            a.title !== '[Removed]' &&
            a.description &&
            a.description !== '[Removed]'
          )
          .forEach(a => {
            allHeadlines.push({
              topic,
              headline: a.title,
              description: a.description,
              source: a.source?.name || 'Unknown',
            });
          });
      }
    }

    if (allHeadlines.length === 0) {
      return res.status(500).json({ error: 'No headlines found from NewsAPI' });
    }

    // Step 2: Send everything to Claude — it decides what's relevant and writes the cards
    const targetCards = Math.max(12, topics.length * 4);

    // Group headlines by topic for Claude
    const groupedList = topics.map(topic => {
      const topicArticles = allHeadlines
        .filter(h => h.topic === topic)
        .slice(0, 30) // send up to 30 per topic to Claude
        .map((h, i) => `  ${i + 1}. "${h.headline}" — ${h.description} (${h.source})`)
        .join('\n');
      return `[${topic}] — Definition: ${topicDefinitions[topic]}\n${topicArticles || '  No articles found'}`;
    }).join('\n\n');

    const prompt = `You are BrushFeed's editorial AI. Your job is to:

1. READ each group of headlines below
2. JUDGE each headline: is it genuinely about the topic it's filed under?
3. KEEP only headlines that truly match their topic definition
4. REJECT anything that is off-topic, even if it seems loosely related
5. Write BrushFeed cards for the ones you keep
6. If a topic doesn't have enough real headlines to fill its share of ${targetCards} cards, GENERATE additional cards using your knowledge of real events from the past 2 weeks

Headlines to evaluate:
${groupedList}

Target: ${targetCards} cards total, spread as evenly as possible across: ${topics.join(', ')}

Strict relevance rules:
- AI topic: ONLY include articles about AI technology, AI companies, AI models, machine learning. Reject: politics, sports, celebrity, general tech that isn't AI-specific
- Parenting topic: ONLY include articles about raising children, child development, family. Reject: general education policy, unrelated family law
- Health topic: ONLY include medical research, health studies, treatments. Reject: general news that mentions health tangentially
- Money topic: ONLY include personal finance, economic conditions affecting individuals. Reject: corporate earnings, general business news
- Science topic: ONLY include scientific research and discoveries. Reject: general news, policy about science
- World topic: ONLY include international news and geopolitics. Reject: purely domestic news

Return a JSON array only. Start with [ and end with ]. Absolutely no other text.

Format: [{"topic":"AI","title":"Punchy title under 9 words","body":"3 sentences with specific facts, numbers, or named organisations.","source":"Publication name","isReal":true}]

isReal: true = from the headlines above, false = generated from your knowledge`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        system: 'You are a strict editorial AI and JSON generator. Be very strict about topic relevance — reject anything that does not clearly belong to its topic. Respond with only a valid JSON array. No markdown, no backticks, no preamble. Start with [ and end with ].',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    if (!claudeRes.ok) {
      return res.status(500).json({ error: claudeData?.error?.message || 'Claude API error' });
    }

    const text = claudeData.content?.map(b => b.text || '').join('') || '';

    // Parse JSON robustly
    let cards = null;
    try { cards = JSON.parse(text.trim()); } catch {}
    if (!cards) {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) try { cards = JSON.parse(match[0]); } catch {}
    }
    if (!cards) {
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start !== -1 && end !== -1) try { cards = JSON.parse(text.slice(start, end + 1)); } catch {}
    }
    if (!cards || !Array.isArray(cards)) {
      return res.status(500).json({ error: 'Could not parse Claude response', raw: text.slice(0, 300) });
    }

    // Final safety — only return cards for requested topics
    const filtered = cards.filter(c => topics.includes(c.topic));

    res.status(200).json(filtered);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
