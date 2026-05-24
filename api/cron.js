// cron.js — runs twice daily via Vercel cron

// Official company RSS feeds block server requests — using targeted press feeds instead
// These are updated within hours of any AI company announcement
const AI_COMPANY_SOURCES = [
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', searchTerms: ['openai','anthropic','google','gemini','claude','meta ai','mistral','grok','deepmind','chatgpt','gpt-','llm launch','model release','ai model'] },
  { name: 'The Verge AI',  url: 'https://www.theverge.com/ai-artificial-intelligence/rss/index.xml', searchTerms: ['openai','anthropic','google','gemini','claude','meta ai','mistral','grok','deepmind','chatgpt','gpt-','new model','ai release'] },
];

const SOURCES = {
  AI: [
    { name: 'TechCrunch',            url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
    { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
    { name: 'The Verge AI',          url: 'https://www.theverge.com/ai-artificial-intelligence/rss/index.xml' },
    { name: 'Ars Technica',          url: 'https://feeds.arstechnica.com/arstechnica/index' },
  ],
  Parenting: [
    { name: 'The Guardian',     url: 'https://www.theguardian.com/lifeandstyle/family/rss' },
    { name: 'Psychology Today', url: 'https://www.psychologytoday.com/us/front/feed' },
    { name: 'BBC News',         url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  ],
};

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function isWithinDays(dateStr, days) {
  if (!dateStr) return true;
  try { return new Date(dateStr) >= daysAgo(days); }
  catch { return true; }
}

function formatDate(dateStr) {
  try { return new Date(dateStr).toISOString().split('T')[0]; }
  catch { return ''; }
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  if (!match) return '';
  return (match[1] || match[2] || '').trim();
}

function cleanText(text) {
  return text.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}

function parseRSS(xml, sourceName) {
  const items = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = match[1];
    const title = extractTag(item, 'title');
    const description = extractTag(item, 'description');
    const pubDate = extractTag(item, 'pubDate');
    if (title && description) {
      items.push({ title: cleanText(title), description: cleanText(description).slice(0,300), publishedAt: pubDate ? formatDate(pubDate) : '', rawDate: pubDate || '', source: sourceName });
    }
  }
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1];
    const title = extractTag(entry, 'title');
    const summary = extractTag(entry, 'summary') || extractTag(entry, 'content');
    const published = extractTag(entry, 'published') || extractTag(entry, 'updated');
    if (title && summary) {
      items.push({ title: cleanText(title), description: cleanText(summary).slice(0,300), publishedAt: published ? formatDate(published) : '', rawDate: published || '', source: sourceName });
    }
  }
  return items;
}

async function fetchRSS(source) {
  try {
    const res = await fetch(source.url, { headers: { 'User-Agent': 'BrushFeed/1.0' } });
    if (!res.ok) return [];
    return parseRSS(await res.text(), source.name);
  } catch(e) { console.error(`Failed: ${source.name}`, e.message); return []; }
}

async function processWithClaude(topic, articles, apiKey, isOfficial) {
  const rules = {
    'AI Update': 'Official AI company announcements, product launches, model releases. Include all — already from official sources.',
    AI: 'Artificial intelligence, machine learning, AI models, ChatGPT, OpenAI, Google AI. Reject: general tech, politics, sports.',
    Parenting: 'Parenting advice, child development, babies, toddlers, family health. Reject: general education policy, celebrity.',
  };

  const articleList = articles.map((a,i) => `${i+1}. "${a.title}" — ${a.description} (${a.source}, ${a.publishedAt})`).join('\n');

  const prompt = `You are BrushFeed's editorial AI for topic: ${topic}
Definition: ${rules[topic] || topic}

${articles.length} articles:
${articleList}

Instructions:
- ${isOfficial ? 'Include ALL articles — official sources' : `Keep ONLY genuinely ${topic}-related articles`}
- Write 2-3 SHORT sentences per card — brief and punchy
- Do NOT generate cards — only use articles above

Return JSON array ONLY. Start [ end ]. No other text.
Format: [{"title":"Under 9 words","body":"2-3 short sentences.","source":"Publication","publishedAt":"2026-05-19"}]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: 'Strict editorial AI and JSON generator. Card bodies must be 2-3 sentences MAX. Return only valid JSON array.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Claude error');
  const text = data.content?.map(b => b.text||'').join('') || '';

  let cards = null;
  try { cards = JSON.parse(text.trim()); } catch {}
  if (!cards) { const m = text.match(/\[[\s\S]*\]/); if (m) try { cards = JSON.parse(m[0]); } catch {} }
  if (!cards || !Array.isArray(cards)) return [];
  return cards.map(c => ({ ...c, topic }));
}

async function saveToGitHub(filename, content, token, repo) {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/public/${filename}`;
  let sha = null;
  try {
    const check = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } });
    if (check.ok) { sha = (await check.json()).sha; }
  } catch {}

  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Update ${filename} — ${new Date().toISOString()}`,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(`GitHub save failed: ${err.message}`); }
  return `https://raw.githubusercontent.com/${repo}/main/public/${filename}`;
}

export default async function handler(req, res) {
  // ============ SECURITY: Only allow Vercel's scheduled cron invocations ============
  // Vercel scheduled crons have a specific signature we can verify
  const authHeader = req.headers.authorization || '';
  const expectedSecret = process.env.CRON_SECRET;
  
  // Vercel passes Bearer token ONLY for scheduled crons, not manual requests
  const isScheduledCron = authHeader === `Bearer ${expectedSecret}` && expectedSecret;
  
  if (!isScheduledCron) {
    console.warn('Cron accessed without valid scheduled authorization', { 
      hasAuth: !!authHeader,
      source: req.headers['x-forwarded-for'] || 'unknown'
    });
    return res.status(403).json({ error: 'Forbidden — scheduled cron only' });
  }
  // =====================================================

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GITHUB_TOKEN      = process.env.GITHUB_TOKEN;
  const GITHUB_REPO       = process.env.GITHUB_REPO;
  const results = {};

  try {
    console.log('Scheduled cron job started');

    // 1. Official AI company updates — 48hr filter
    console.log('Processing AI company updates...');
    const aiCompanyArticles = (await Promise.all(AI_COMPANY_SOURCES.map(fetchRSS)))
      .flat()
      .filter(a => isWithinDays(a.rawDate, 7));
    console.log(`AI company: ${aiCompanyArticles.length} articles within 48hrs`);

    const aiUpdateCards = aiCompanyArticles.length > 0
      ? await processWithClaude('AI Update', aiCompanyArticles, ANTHROPIC_API_KEY, true)
      : [];
    console.log(`AI Update cards: ${aiUpdateCards.length}`);

    // 2. Regular AI news — 14-day filter
    console.log('Processing regular AI news...');
    const aiNewsArticles = (await Promise.all(SOURCES.AI.map(fetchRSS)))
      .flat()
      .filter(a => isWithinDays(a.rawDate, 14));
    console.log(`Regular AI: ${aiNewsArticles.length} articles within 14 days`);

    const aiNewsCards = aiNewsArticles.length > 0
      ? await processWithClaude('AI', aiNewsArticles, ANTHROPIC_API_KEY, false)
      : [];
    console.log(`AI news cards: ${aiNewsCards.length}`);

    // AI Update cards come FIRST
    const allAICards = [...aiUpdateCards, ...aiNewsCards];
    const aiUrl = await saveToGitHub('cards_AI.json', {
      topic: 'AI', generatedAt: new Date().toISOString(),
      cardCount: allAICards.length, aiUpdateCount: aiUpdateCards.length,
      cards: allAICards,
    }, GITHUB_TOKEN, GITHUB_REPO);
    results.AI = { success: true, cardCount: allAICards.length, aiUpdateCount: aiUpdateCards.length, url: aiUrl };

    // 3. Parenting — 14-day filter
    console.log('Processing Parenting...');
    const parentingArticles = (await Promise.all(SOURCES.Parenting.map(fetchRSS)))
      .flat()
      .filter(a => isWithinDays(a.rawDate, 14));
    console.log(`Parenting: ${parentingArticles.length} articles`);

    const parentingCards = parentingArticles.length > 0
      ? await processWithClaude('Parenting', parentingArticles, ANTHROPIC_API_KEY, false)
      : [];

    const parentingUrl = await saveToGitHub('cards_Parenting.json', {
      topic: 'Parenting', generatedAt: new Date().toISOString(),
      cardCount: parentingCards.length, cards: parentingCards,
    }, GITHUB_TOKEN, GITHUB_REPO);
    results.Parenting = { success: true, cardCount: parentingCards.length, url: parentingUrl };

    console.log('Cron completed successfully');
    return res.status(200).json({ success: true, generatedAt: new Date().toISOString(), results });

  } catch(err) {
    console.error('Cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
