export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const topics = (req.query.topics || 'AI,Health').split(',');
  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  try {
    const topicQueries = {
      AI: 'artificial intelligence OR machine learning',
      Parenting: 'parenting OR children',
      Health: 'health OR medicine OR wellness',
      Money: 'personal finance OR economy',
      Science: 'science OR research OR discovery',
      World: 'world news OR global politics',
    };

    const headlines = [];
    for (const topic of topics) {
      const query = topicQueries[topic] || topic;
      const newsRes = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=4&language=en&apiKey=${NEWS_API_KEY}`
      );
      const newsData = await newsRes.json();
      if (newsData.articles) {
        newsData.articles.forEach(a => {
          if (a.title && a.title !== '[Removed]') {
            headlines.push({ topic, headline: a.title, description: a.description || '', source: a.source?.name || '' });
          }
        });
      }
    }

    if (headlines.length === 0) {
      return res.status(500).json({ error: 'No headlines found' });
    }

    const prompt = `You are BrushFeed's content engine. Turn these news headlines into feed cards.

Headlines:
${headlines.slice(0, 15).map((h, i) => `${i+1}. [${h.topic}] "${h.headline}" - ${h.description} (${h.source})`).join('\n')}

Return a JSON array only. Start your response with [ and end with ]. No other text before or after.

Format: [{"topic":"AI","title":"Short title under 9 words","body":"3 sentences expanding on this story with context.","source":"Publication name"}]

Return up to ${Math.min(headlines.length, 12)} cards, one per headline.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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
    
    // Try multiple ways to extract JSON
    let cards = null;
    
    // Method 1: direct parse
    try { cards = JSON.parse(text.trim()); } catch {}
    
    // Method 2: extract array
    if (!cards) {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) try { cards = JSON.parse(match[0]); } catch {}
    }
    
    // Method 3: find first [ to last ]
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

    res.status(200).json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
