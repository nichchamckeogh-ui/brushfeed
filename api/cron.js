import { put } from '@vercel/blob';

// ── RSS SOURCES ───────────────────────────────────────────────────────────────
const SOURCES = {
  AI: [
    { name: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
    { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
    { name: 'The Verge AI', url: 'https://www.theverge.com/ai-artificial-intelligence/rss/index.xml' },
    { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/' },
  ],
  Parenting: [
    { name: 'The Guardian Parents', url: 'https://www.theguardian.com/lifeandstyle/family/rss' },
    { name: 'Psychology Today', url: 'https://www.psychologytoday.com/us/front/feed' },
    { name: 'BBC Family', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  ],
};

// ── XML PARSER ────────────────────────────────────────────────────────────────
function parseRSS(xml) {
  const items = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const item = match[1];
    const title = extractTag(item, 'title');
    const description = extractTag(item, 'description');
    const pubDate = extractTag(item, 'pubDate');
    if (title && title !== '' && description && description !== '') {
      items.push({
        title: cleanText(title),
        description: cleanText(description).slice(0, 200),
        publishedAt: pubDate ? formatDate(pubDate) : '',
      });
    }
  }
  return items;
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!match) return '';
  return (match[1] || match[2] || '').trim();
}

function cleanText(text) {
  return text
    .replace(/<[^>]+>/g, '') // remove HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toISOString().split('T')[0];
  } catch { return ''; }
}

// ── FETCH RSS FEED ────────────────────────────────────────────────────────────
async function fetchRSS(source) {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'BrushFeed/1.0 (RSS Reader)' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRSS(xml);
    return items.slice(0, 25).map(item => ({ ...item, source: source.name }));
  } catch (e) {
    console.error(`Failed to fetch ${source.name}:`, e.message);
    return [];
  }
}

// ── CLAUDE FILTER + SUMMARISE ─────────────────────────────────────────────────
async function processWithClaude(topic, articles, apiKey) {
  const topicRules = {
    AI: 'artificial intelligence, machine learning, AI models, ChatGPT, OpenAI, Google AI, robotics, AI regulation, AI safety, large language models. Reject: general tech news not specifically about AI, politics, sports, celebrity.',
    Parenting: 'parenting advice, child development, babies, toddlers, kids education, screen time, child psychology, family health, teenage wellbeing. Reject: general education policy, unrelated family law, celebrity families.',
  };

  const articleList = articles
    .map((a, i) => `${i + 1}. "${a.title}" — ${a.description} (${a.source}, ${a.publishedAt})`)
    .join('\n');

  const prompt = `You are BrushFeed's editorial AI for the topic: ${topic}

Topic definition: ${topicRules[topic]}

Below are ${articles.length} RSS articles. Your job:
1. Read each article
2. KEEP only articles genuinely about ${topic} — be strict
3. REJECT anything off-topic
4. Write a clean BrushFeed card for each kept article
5. Do NOT generate any cards — only use real articles above
6. If fewer than 3 articles pass, just return what you have

Articles:
${articleList}

Return JSON array ONLY. Start with [ end with ]. No other text.

Format: [{"title":"Under 9 words","body":"3 sentences expanding on the story with specific facts.","source":"Publication name","publishedAt":"2026-05-16"}]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: 'You are a strict editorial AI and JSON generator. Respond with only a valid JSON array. No markdown, no backticks, no preamble. Start with [ and end with ].',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Claude error');

  const text = data.content?.map(b => b.text || '').join('') || '';

  let cards = null;
  try { cards = JSON.parse(text.trim()); } catch {}
  if (!cards) {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) try { cards = JSON.parse(match[0]); } catch {}
  }
  if (!cards || !Array.isArray(cards)) return [];

  // Add topic to each card
  return cards.map(c => ({ ...c, topic }));
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Security: only allow Vercel cron calls or manual trigger with secret
  //const authHeader = req.headers.authorization;
  //if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  //  return res.status(401).json({ error: 'Unauthorised' });
  //}

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const activeTopics = ['AI', 'Parenting'];
  const results = {};

  try {
    for (const topic of activeTopics) {
      console.log(`Processing topic: ${topic}`);
      const sources = SOURCES[topic] || [];

      // Fetch all RSS sources for this topic in parallel
      const fetchPromises = sources.map(s => fetchRSS(s));
      const fetchResults = await Promise.all(fetchPromises);
      const allArticles = fetchResults.flat();

      console.log(`${topic}: fetched ${allArticles.length} articles from RSS`);

      if (allArticles.length === 0) {
        results[topic] = { error: 'No articles fetched' };
        continue;
      }

      // Call Claude ONCE per topic
      const cards = await processWithClaude(topic, allArticles, ANTHROPIC_API_KEY);
      console.log(`${topic}: Claude returned ${cards.length} cards`);

      // Save to Vercel Blob
      const payload = {
        topic,
        generatedAt: new Date().toISOString(),
        cardCount: cards.length,
        cards,
      };

      const blob = await put(`cards_${topic}.json`, JSON.stringify(payload), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false, // always overwrite same file
      });

      results[topic] = {
        success: true,
        cardCount: cards.length,
        blobUrl: blob.url,
      };

      console.log(`${topic}: saved to blob at ${blob.url}`);
    }

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      results,
    });

  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
