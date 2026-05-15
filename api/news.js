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
  // Upstash REST API: SET key value EX seconds
  async function cacheSet(key, value, exSeconds) {
    try {
      // Use the pipeline format: /set/key/value?EX=seconds
      // Value must be a plain string — so stringify once
      const stringValue = JSON.stringify(value);
      await fetch(`${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(stringValue)}?EX=${exSeconds}`, {
        method: 'GET', // Upstash REST supports GET for simple commands
        headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      });
    } catch (e) {
      console.error('Cache set error:', e);
    }
  }

  // Upstash REST API: GET key
  async function cacheGet(key) {
    try {
      const r = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      });
      const data = await r.json();
      if (!data.result) return null;
      // data.result is a string — parse it back to object
      return JSON.parse(data.result);
    } catch (e) {
      console.error('Cache get error:', e);
      return null;
    }
  }

  // ── STEP 1: CHECK CACHE FIRST ──────────────────────────────────────────────
  try {
    const cached = await cacheGet(cacheKey);
    if (cached && Array.isArray(cached.cards) && cached.cards.length > 0) {
      console.log('Cache hit:', cacheKey);
      return res.status(200).json({
        cards: cached.cards,
        fromCache: true,
        cachedAt: cached.cachedAt,
        nextFetchAt: cached.nextFetchAt,
      });
    }
  } catch (e) {
    console.error('Cache check failed, proceeding to fetch:', e);
  }

  console.log('Cache miss — fetching fresh news');

  // ── STEP 2: FETCH FROM NEWSAPI IN PARALLEL ─────────────────────────────────
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
        .slice(0, 10)
        .map(a => ({
          topic,
          headline: a.title,
          description: a.description,
          source: a.source?.name || 'Unknown',
          publishedAt: a.publishedAt ? a.publishedAt.split('T')[0] : '',
        }));
    } catch { return []; }
  });

  const results = await Promise.all(fetchPromises);
  const allHeadlines = results.flat();

  if (allHeadlines.length === 0) {
    return res.status(500).json({ error: 'No headlines found from NewsAPI' });
  }

  // ── STEP 3: ONE SINGLE CLAUDE CALL FOR ALL TOPICS ─────────────────────────
  const targetCards = Math.max(12, topics.length * 3);

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

  const prompt = `You are BrushFeed's editorial AI. Below are ${allHeadlines.length} news headlines.

Your job:
1. Keep only headlines genuinely relevant to their topic label
2. Reject anything off-topic
3. Write a BrushFeed card for each kept headline
4. If fewer than 3 real cards per topic, generate extras from real 2024-2025 events

Topic rules:
${rulesText}

Headlines:
${headlineList}

Target: ${targetCards} cards spread evenly across: ${topics.join(', ')}

Return JSON array ONLY. Start with [ end with ]. No other text.

Format: [{"topic":"AI","title":"Under 9 words","body":"3 sentences with specific facts.","source":"Publication","publishedAt":"2025-05-10","isReal":true}]`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
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

  // ── STEP 4: SAVE TO CACHE ──────────────────────────────────────────────────
  const now = new Date();
  const nextFetch = new Date(now.getTime() + CACHE_SECONDS * 1000);

  const cachePayload = {
    cards: filtered,
    topics,
    cachedAt: now.toISOString(),
    nextFetchAt: nextFetch.toISOString(),
  };

  await cacheSet(cacheKey, cachePayload, CACHE_SECONDS);

  // ── STEP 5: RETURN ─────────────────────────────────────────────────────────
  return res.status(200).json({
    cards: filtered,
    fromCache: false,
    cachedAt: now.toISOString(),
    nextFetchAt: nextFetch.toISOString(),
  });
}
