async function handleStart() {
  setLoadError(null);
  setLoadingFirst(true);
  setFeed([]);
  try {
    const res = await fetch(`/api/news?topics=${topics.join(',')}`);
    if (!res.ok) throw new Error('Failed to fetch news');
    const cards = await res.json();
    if (cards.error) throw new Error(cards.error);
    setFeed([...cards, ...cards, ...cards]);
    setCurrentIndex(0);
    setCardProgress(0);
    setTimeLeft(DURATION);
    setTotalProgress(0);
    startRef.current = null;
    setScreen("feed");
  } catch(e) {
    setLoadError(e.message || "Couldn't load. Try again.");
  } finally {
    setLoadingFirst(false);
  }
}
