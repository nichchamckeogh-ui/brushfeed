import { list, getDownloadUrl } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const topics = (req.query.topics || 'AI,Parenting').split(',');

  try {
    const allCards = [];
    const meta = {};

    const readPromises = topics.map(async topic => {
      try {
        const { blobs } = await list({ prefix: `cards_${topic}.json` });
        if (!blobs || blobs.length === 0) return;
        
        const downloadUrl = await getDownloadUrl(blobs[0].url);
        const blobRes = await fetch(downloadUrl);
        if (!blobRes.ok) return;
        
        const data = await blobRes.json();
        if (data.cards && Array.isArray(data.cards)) {
          allCards.push(...data.cards);
          meta[topic] = {
            generatedAt: data.generatedAt,
            cardCount: data.cardCount,
          };
        }
      } catch (e) {
        console.error(`Error reading ${topic}:`, e.message);
      }
    });

    await Promise.all(readPromises);

    if (allCards.length === 0) {
      return res.status(503).json({
        error: 'Feed not ready yet. Please try again in a few minutes.',
      });
    }

    // Shuffle
    for (let i = allCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allCards[i], allCards[j]] = [allCards[j], allCards[i]];
    }

    return res.status(200).json({
      cards: allCards,
      meta,
      servedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Feed error:', err);
    return res.status(500).json({ error: err.message });
  }
}
