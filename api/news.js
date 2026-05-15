export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const topics = (req.query.topics || 'AI,Health').split(',');
  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  try {
    // Fetch real headlines from NewsAPI for each topic
    const topicQueries = {
      AI: 'artificial intelligence OR machine learning',
      Parenting: 'parenting OR children development',
      Health: 'health OR medicine OR wellness',
      Money: 'personal finance OR economy OR investing',
      Science: 'science OR research OR discovery',
      World: 'world news OR global',
    };

    const headlines = [];
    for (const topic of topics) {
      const query = topicQueries[topic] || topic;
      const newsRes = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=5&language=en&apiKey=${NEWS_API_KEY}`
      );
      const newsData = await newsRes.json();
      if (newsData.articles) {
        newsData.articles.forEach(a => {
          headlines.push({
            topic,
            headline: a.title,
            description: a.description || '',
            source: a.source?.name || '',
          });
        });
      }
    }

    // Send headlines to Claude to turn into BrushFeed cards
    const prompt = `You are BrushFeed's content engine. Turn these real news headlines into exactly ${Math.min(headlines.length, 12)} feed cards.

Headlines:
${headlines.slice(0, 20).map((h, i) => `${i+1}. [${h.topic}] ${h.headline} - ${h.description} (${h.source})`).join('\n')}

Return ONLY a raw JSON array — no markdown, no backticks. Format:
[{"topic":"AI","title":"Under 9 words","body":"3 sentences expanding on the story with context and facts.","source":"Publication name"}]

Rules: keep original topic labels · write informative body expanding on the headline · prose only · return up to 12 cards.`;

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
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const text = claudeData.content?.map(b => b.text || '').join('') || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON in Claude response');
    const cards = JSON.parse(match[0]);

    res.status(200).json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
