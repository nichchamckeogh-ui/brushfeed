export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const topics = (req.query.topics || 'AI,Health').split(',');
  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  try {
    // Very specific queries for each topic to get relevant results
    const topicQueries = {
      AI: '"artificial intelligence" OR "machine learning" OR "ChatGPT" OR "OpenAI" OR "Google AI" OR "large language model"',
      Parenting: '"parenting" OR "child development" OR "toddler" OR "baby sleep" OR "screen time children"',
      Health: '"health study" OR "medical research" OR "nutrition" OR "mental health" OR "exercise science"',
      Money: '"personal finance" OR "saving money" OR "interest rates" OR "cost of living" OR "investment tips"',
      Science: '"scientific discovery" OR "new research" OR "space exploration" OR "climate science" OR "biology"',
      World: '"world news" OR "international" OR "global economy" OR "geopolitics"',
    };

    const headlines = [];

    for (const topic of topics) {
      const query = topicQueries[topic] || topic;
      const newsRes = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=6&language=en&apiKey=${NEWS_API_KEY}`
      );
      const newsData = await newsRes.json();

      if (newsData.articles) {
        newsData.articles
          .filter(a => a.title && a.title !== '[Removed]' && a.description && a.description !== '[Removed]')
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
      return res.status(500).json({ error: 'No headlines found' });
    }

    // Group by topic so Claude knows exactly which topic each card should be
    const grouped = topics.map(t => ({
      topic: t,
      articles: headlines.filter(h => h.topic === t),
    }));

    const articleList = grouped
      .flatMap(g => g.articles.map((a, i) => `[${a.topic}] ${a.headline} — ${a.description} (${a.source})`))
      .join('\n');

    const prompt = `Turn these news headlines into BrushFeed cards. Each card must use the topic label shown in brackets.

${articleList}

Return a JSON array only. Start with [ and end with ]. No other text.

Format: [{"topic":"AI","title":"Short title under 9 words","body":"3 sentences expanding on this story.","source":"Publication name"}]

Important: the topic field must exactly match the label in brackets. Return one card per headline.`;

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
      if (start !== -1 && end !== -1) {
        try { cards = JSON.parse(text.slice(start, end + 1)); } catch {}
      }
    }

    if (!cards || !Array.isArray(cards)) {
      return res.status(500).json({ error: 'Could not parse response', raw: text.slice(0, 200) });
    }

    // Final safety filter — only return cards matching requested topics
    const filtered = cards.filter(c => topics.includes(c.topic));

    res.status(200).json(filtered);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
