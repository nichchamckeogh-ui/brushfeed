export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const topics = (req.query.topics || 'AI,Health').split(',');
  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  const topicQueries = {
    AI: '"artificial intelligence" OR "machine learning" OR "ChatGPT" OR "OpenAI" OR "large language model" OR "generative AI"',
    Parenting: '"parenting" OR "child development" OR "toddler" OR "baby sleep" OR "screen time children" OR "kids health"',
    Health: '"health study" OR "medical research" OR "nutrition science" OR "mental health" OR "exercise science" OR "new treatment"',
    Money: '"personal finance" OR "interest rates" OR "cost of living" OR "saving money" OR "household budget" OR "mortgage rates"',
    Science: '"scientific discovery" OR "space exploration" OR "climate research" OR "new study finds" OR "researchers discover"',
    World: '"world news" OR "international relations" OR "global economy" OR "foreign policy" OR "United Nations"',
  };

  const topicKeywords = {
    AI: ['ai', 'artificial intelligence', 'machine learning', 'chatgpt', 'openai', 'llm', 'robot', 'automation', 'deep learning', 'neural', 'claude', 'gemini', 'gpt', 'language model'],
    Parenting: ['parent', 'child', 'baby', 'toddler', 'kid', 'mother', 'father', 'family', 'screen time', 'teen', 'infant', 'pregnancy', 'mum', 'dad'],
    Health: ['health', 'medical', 'doctor', 'diet', 'exercise', 'mental health', 'wellness', 'cancer', 'heart', 'brain', 'sleep', 'nutrition', 'hospital', 'treatment', 'disease'],
    Money: ['finance', 'money', 'invest', 'saving', 'budget', 'bank', 'interest rate', 'cost', 'salary', 'debt', 'mortgage', 'inflation', 'stock', 'pension', 'tax'],
    Science: ['science', 'research', 'discover', 'space', 'climate', 'physics', 'biology', 'chemistry', 'planet', 'nasa', 'experiment', 'gene', 'ocean', 'atmosphere'],
    World: ['world', 'global', 'international', 'country', 'nation', 'government', 'politics', 'war', 'peace', 'trade', 'europe', 'asia', 'africa', 'election', 'treaty'],
  };

  try {
    const headlines = [];

    for (const topic of topics) {
      const query = topicQueries[topic] || topic;
      const newsRes = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=8&language=en&apiKey=${NEWS_API_KEY}`
      );
      const newsData = await newsRes.json();

      if (newsData.articles) {
        const keywords = topicKeywords[topic] || [];
        newsData.articles
          .filter(a => {
            if (!a.title || a.title === '[Removed]' || !a.description || a.description === '[Removed]') return false;
            const text = `${a.title} ${a.description}`.toLowerCase();
            return keywords.some(k => text.includes(k));
          })
          .slice(0, 4)
          .forEach(a => {
            headlines.push({
              topic,
              headline: a.title,
              description: a.description || '',
              source: a.source?.name || '',
            });
          });
      }
    }

    if (headlines.length === 0) {
      return res.status(500).json({ error: 'No relevant headlines found' });
    }

    const articleList = headlines
      .map(h => `[${h.topic}] ${h.headline} — ${h.description} (${h.source})`)
      .join('\n');

    const prompt = `Turn these news headlines into BrushFeed cards. Keep the topic label exactly as shown in brackets.

${articleList}

Return a JSON array only. Start with [ and end with ]. No other text before or after.

Format: [{"topic":"AI","title":"Short title under 9 words","body":"3 sentences expanding on this story with useful context.","source":"Publication name"}]

One card per headline. Topic field must match the label in brackets exactly.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 3000,
        system: 'You are a JSON generator. Always respond with only a valid JSON array, nothing else. No markdown, no backticks, no explanation. Start with [ and end with ].',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    if (!claudeRes.ok) {
      return res.status(500).json({ error: claudeData?.error?.message || 'Claude API error' });
    }

    const text = claudeData.content?.map(b => b.text || '').join('') || '';

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
      return res.status(500).json({ error: 'Could not parse response', raw: text.slice(0, 200) });
    }

    res.status(200).json(cards);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
