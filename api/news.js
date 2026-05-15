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

  // ── STEP 1: CHECK CACHE FIRST ──────────────────────────────────────────────
  const cached = await cacheGet(cacheKey);
  if (cached && Array.isArray(cached.cards) && cached.cards.length > 0) {
    return res.status(200).json({
      cards: cached.cards,
      fromCache: true,
      cachedAt: cached.cachedAt,
      nextFetchAt: cached.nextFetchAt,
    });
  }

  // ── STEP 2: FETCH FROM NEWSAPI — ONE REQUEST PER TOPIC IN PARALLEL ─────────
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

  // Fetch all topics in parallel — faster and still one Claude call after
  const fetchPromises = topics.map(async topic => {
    const query = topicQueries[topic] || topic;
    try {
      const newsRes = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=20&language=en&from=${twoWeeksAgo}&apiKey=${NEWS_API_KEY}`
      );
      const newsData = await newsRes.json();
      if (!newsData.articles) return [];
      return newsData.articles
        .filter(a => a.title && a.title !== '[Removed]' && a.description && a.description !== '[Removed]')
        .slice(0, 15) // max 15 per topic to keep Claude prompt small
        .map(a => ({
          topic,
          headline: a.title,
          description: a.description,
          source: a.source?.name || 'Unknown',
          publishedAt: a.publishedAt ? a.publishedAt.split('T')[0] : '',
        }));
    } catch { return []; }
  });

  // Wait for ALL NewsAPI fetches to complete
  const results = await Promise.all(fetchPromises);
  const allHeadlines = results.flat();

  if (allHeadlines.length === 0) {
    return res.status(500).json({ error: 'No headlines found from NewsAPI' });
  }

  // ── STEP 3: ONE SINGLE CLAUDE CALL FOR ALL TOPICS ─────────────────────────
  const targetCards = Math.max(12, topics.length * 3);

  // Format all headlines together in one list, labelled by topic
  const headlineList = allHeadlines
    .map((h, i) => `${i + 1}. [${h.topic}] "${h.headline}" — ${h.description} (${h.source}, ${h.publishedAt})`)
    .join('\n');

  const topicRules = {
    AI:        'ONLY AI technology, machine learning, AI models, ChatGPT, OpenAI. Reject general tech, politics, sports.',
    Parenting: 'ONLY raising children, child development, babies, toddlers, family. Reject general education policy.',
    Health:    'ONLY medical research, health studies, treatments, wellness. Reject tangential health mentions.',
    Money:     'ONLY personal finance, cost of living, savings, investing. Reject corporate earnings news.',
    Science:   'ONLY scientific research and discoveries, space, climate science. Reject science policy.',
    World:     'ONLY international news, geopolitics, foreign policy. Reject purely domestic stories.',
  };

  const rulesText = topics.map(t => `- ${t}: ${topicRules[t] || t}`).join('\n');

  const prompt = `You are BrushFeed's editorial AI. Below are ${allHeadlines.length} news headlines across ${topics.length} topic(s).

Your job:
1. Read ALL headlines
2. Keep only headlines genuinely relevant to their topic label
3. Reject anything off-topic
4. Write a BrushFeed card for each kept headline
5. If a topic has fewer than 3 real cards, generate extras from your knowledge of real 2024-2025 events

Topic rules:
${rulesText}

Headlines:
${headlineList}

Target: ${targetCards} cards total, spread evenly across: ${topics.join(', ')}

Return a JSON array ONLY. Start with [ and end with ]. No other text at all.

Format: [{"topic":"AI","title":"Under 9 words","body":"3 sentences with specific facts.","source":"Publication name","publishedAt":"2025-05-10","isReal":true}]`;

  // ← This is called EXACTLY ONCE regardless of how many topics are selected
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
      system: 'You are a strict editorial AI and JSON generator. Respond with only a valid JSON array. No markdown, no backticks, no preamble. Start with [ and end with ].',
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
