export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const topics = (req.query.topics || 'AI,Health').split(',').sort();
  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  const cacheKey = `brushfeed_${topics.join('_')}`;
  const CACHE_SECONDS = 6 * 60 * 60; // 6 hours

  // ── UPSTASH HELPERS ────────────────────────────────────────────────────────
  async function cacheGet(key) {
    try {
      const r = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${key}`, {
        headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      });
      const data = await r.json();
      return data.result ? JSON.parse(data.result) : null;
    } catch { return null; }
  }

  async function cacheSet(key, value, exSeconds) {
    try {
      await fetch(`${UPSTASH_REDIS_REST_URL}/set/${key}?EX=${exSeconds}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(JSON.stringify(value)),
      });
    } catch {}
  }

  // ── STEP 1: CHECK CACHE ────────────────────────────────────────────────────
  const cached = await cacheGet(cacheKey);
  if (cached && Array.isArray(cached.cards) && cached.cards.length > 0) {
    return res.status(200).json({
      cards: cached.cards,
      fromCache: true,
      cachedAt: cached.cachedAt,
      nextFetchAt: cached.nextFetchAt,
    });
  }

  // ── STEP 2: FETCH FROM NEWSAPI ─────────────────────────────────────────────
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  const topicQueries = {
    AI:        'artificial intelligence',
    Parenting: 'parenting children',
    Health:    'health medical',
    Money:     'personal finance',
    Science:   'science research',
    World:     'world news international',
  };

  const topicDefinitions = {
    AI:        'artificial intelligence, machine learning, AI models, ChatGPT, OpenAI, Google AI, robotics, AI regulation, AI safety, large language models',
    Parenting: 'parenting advice, child development, babies, toddlers, kids education, screen time, child psychology, family health, teenage wellbeing',
    Health:    'medical research, health studies, nutrition, mental health, exercise science, new treatments, clinical trials, wellness, disease prevention',
    Money:     'personal finance, saving money, investing, budgeting, interest rates, mortgages, cost of living, inflation, pensions, salary',
    Science:   'scientific discoveries, space exploration, climate science, biology, physics, chemistry, genetics, NASA, research breakthroughs',
    World:     'international news, geopolitics, global economy, foreign policy, world leaders, diplomacy, international relations, global conflicts',
  };

  const allHeadlines = [];

  for (const topic of topics) {
    const query = topicQueries[topic] || topic;
    try {
      const newsRes = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=100&language=en&from=${twoWeeksAgo}&apiKey=${NEWS_API_KEY}`
      );
      const newsData = await newsRes.json();
      if (newsData.articles) {
        newsData.articles
          .filter(a => a.title && a.title !== '[Removed]' && a.description && a.description !== '[Removed]')
          .forEach(a => {
            allHeadlines.push({
              topic,
              headline: a.title,
              description: a.description,
              source: a.source?.name || 'Unknown',
              publishedAt: a.publishedAt || '',
            });
          });
      }
    } catch {}
  }

  if (allHeadlines.length === 0) {
    return res.status(500).json({ error: 'No headlines found from NewsAPI' });
  }

  // ── STEP 3: CLAUDE FILTERS AND WRITES CARDS ────────────────────────────────
  const targetCards = Math.max(12, topics.length * 4);

  const groupedList = topics.map(topic => {
    const articles = allHeadlines
      .filter(h => h.topic === topic)
      .slice(0, 30)
      .map((h, i) => `  ${i+1}. "${h.headline}" — ${h.description} (${h.source}, ${h.publishedAt ? h.publishedAt.split('T')[0] : 'recent'})`)
      .join('\n');
    return `[${topic}] Definition: ${topicDefinitions[topic]}\n${articles || '  No articles found'}`;
  }).join('\n\n');

  const prompt = `You are BrushFeed's editorial AI.

1. READ each group of headlines below
2. KEEP only headlines genuinely about their topic, REJECT anything off-topic
3. Write BrushFeed cards for kept headlines
4. If not enough real headlines, GENERATE extras from your knowledge of real 2024-2025 events to reach the target

Headlines:
${groupedList}

Target: ${targetCards} cards spread evenly across: ${topics.join(', ')}

Strict topic rules:
- AI: ONLY AI technology, machine learning, AI companies. Reject general tech, politics, sports
- Parenting: ONLY raising children, child development. Reject general education policy
- Health: ONLY medical research, treatments, health studies. Reject tangential mentions
- Money: ONLY personal finance, cost of living for individuals. Reject corporate news
- Science: ONLY scientific research and discoveries. Reject science policy
- World: ONLY international news, geopolitics. Reject purely domestic stories

Return JSON array only. Start with [ end with ]. No other text whatsoever.

Format: [{"topic":"AI","title":"Under 9 words","body":"3 sentences with specific facts and numbers.","source":"Publication name","publishedAt":"2025-05-10","isReal":true}]

isReal:true = from headlines above, false = generated from your knowledge`;

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
      system: 'You are a strict editorial AI and JSON generator. Be very strict about topic relevance. Respond with only a valid JSON array. No markdown, no backticks, no preamble. Start with [ and end with ].',
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
    return res.status(500).json({ error: 'Could not parse Claude response', raw: text.slice(0, 300) });
  }

  const filtered = cards.filter(c => topics.includes(c.topic));

  // ── STEP 4: SAVE TO CACHE FOR 6 HOURS ─────────────────────────────────────
  const now = new Date();
  const nextFetch = new Date(now.getTime() + CACHE_SECONDS * 1000);

  await cacheSet(cacheKey, {
    cards: filtered,
    topics,
    cachedAt: now.toISOString(),
    nextFetchAt: nextFetch.toISOString(),
  }, CACHE_SECONDS);

  // ── STEP 5: RETURN ─────────────────────────────────────────────────────────
  return res.status(200).json({
    cards: filtered,
    fromCache: false,
    cachedAt: now.toISOString(),
    nextFetchAt: nextFetch.toISOString(),
  });
}
