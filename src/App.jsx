import { useState, useEffect, useRef } from "react";

const DEFAULT_SETTINGS = {
  fontSize: "medium", cardSpeed: 10, theme: "dark",
  accentColor: "teal", fontStyle: "sans", showNextPreview: true,
};
const ACCENT_COLORS = { teal:"#00f5d4", pink:"#ff6b9d", yellow:"#f9c74f", blue:"#7eb8f7" };
const THEMES = {
  dark:  { bg:"#0a0a10", card:"rgba(255,255,255,0.05)", text:"#fff", sub:"rgba(255,255,255,0.68)", hint:"rgba(255,255,255,0.28)", border:"rgba(255,255,255,0.07)", track:"rgba(255,255,255,0.08)", pill:"rgba(255,255,255,0.07)" },
  light: { bg:"#f5f3ee", card:"rgba(0,0,0,0.04)", text:"#1a1a1a", sub:"rgba(0,0,0,0.62)", hint:"rgba(0,0,0,0.28)", border:"rgba(0,0,0,0.08)", track:"rgba(0,0,0,0.1)", pill:"rgba(0,0,0,0.06)" },
  sepia: { bg:"#f2e8d9", card:"rgba(0,0,0,0.04)", text:"#2c1a0e", sub:"rgba(44,26,14,0.65)", hint:"rgba(44,26,14,0.3)", border:"rgba(44,26,14,0.08)", track:"rgba(44,26,14,0.1)", pill:"rgba(44,26,14,0.07)" },
};
const FONT_SIZES = { small:{title:20,body:16}, medium:{title:24,body:19}, large:{title:30,body:23} };
const TOPIC_META = {
  AI:        { emoji:"🤖", color:"#00f5d4" },
  Parenting: { emoji:"👶", color:"#ff6b9d" },
  Health:    { emoji:"💪", color:"#f9c74f" },
  Money:     { emoji:"💸", color:"#a8dadc" },
  Science:   { emoji:"🔬", color:"#c77dff" },
  World:     { emoji:"🌍", color:"#f4a261" },
};
const DURATION = 120;

function loadPrefs() {
  try { const r = sessionStorage.getItem("bf_prefs"); return r ? {...DEFAULT_SETTINGS,...JSON.parse(r)} : DEFAULT_SETTINGS; }
  catch { return DEFAULT_SETTINGS; }
}
function savePrefs(p) { try { sessionStorage.setItem("bf_prefs", JSON.stringify(p)); } catch {} }

export default function BrushFeed() {
  const [screen, setScreen] = useState("home");
  const [topics, setTopics] = useState(["AI","Parenting"]);
  const [settings, setSettings] = useState(loadPrefs);
  const [feed, setFeed] = useState([]);
  const [loadingFirst, setLoadingFirst] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cardProgress, setCardProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [totalProgress, setTotalProgress] = useState(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  const th = THEMES[settings.theme];
  const ac = ACCENT_COLORS[settings.accentColor];
  const fs = FONT_SIZES[settings.fontSize];
  const ff = settings.fontStyle === "serif" ? "'Fraunces',serif" : "'DM Sans',sans-serif";
  const totalCards = Math.floor(DURATION / settings.cardSpeed);

  function updSetting(k, v) { const n={...settings,[k]:v}; setSettings(n); savePrefs(n); }

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
      setLoadError(e.message || "Couldn't load news. Please try again.");
    } finally {
      setLoadingFirst(false);
    }
  }

  useEffect(() => {
    if (screen !== "feed") return;
    function tick(ts) {
      if (!startRef.current) startRef.current = ts;
      const elapsed = (ts - startRef.current) / 1000;
      setTotalProgress(Math.min(elapsed/DURATION, 1));
      setTimeLeft(Math.max(0, Math.ceil(DURATION-elapsed)));
      setCurrentIndex(Math.floor(elapsed/settings.cardSpeed));
      setCardProgress((elapsed%settings.cardSpeed)/settings.cardSpeed);
      if (elapsed < DURATION) rafRef.current = requestAnimationFrame(tick);
      else setScreen("done");
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [screen, feed, settings.cardSpeed]);

  function toggleTopic(t) {
    setTopics(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev,t]);
  }

  const mins = Math.floor(timeLeft/60);
  const secs = String(timeLeft%60).padStart(2,"0");
  const current = feed[currentIndex];
  const next = feed[currentIndex+1];
  const tMeta = current ? TOPIC_META[current.topic] : null;
  const nMeta = next ? TOPIC_META[next.topic] : null;

  return (
    <div style={{minHeight:"100vh",background:th.bg,color:th.text,display:"flex",alignItems:"center",justifyContent:"center",transition:"background 0.4s",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@300;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
        @keyframes cardIn{from{opacity:0;transform:translateY(22px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .card-anim{animation:cardIn 0.42s cubic-bezier(0.22,1,0.36,1) both;}
        .fade-in{animation:fadeIn 0.4s ease both;}
        .topic-btn{cursor:pointer;border-radius:999px;padding:11px 22px;font-family:'DM Sans',sans-serif;font-size:16px;font-weight:500;transition:all 0.2s;}
        .cta{cursor:pointer;border:none;border-radius:999px;padding:17px 52px;font-family:'DM Sans',sans-serif;font-weight:700;font-size:17px;transition:transform 0.15s,opacity 0.15s;}
        .cta:hover:not(:disabled){transform:scale(1.03);}
        .cta:disabled{opacity:0.3;cursor:not-allowed;}
        .ghost-btn{cursor:pointer;background:transparent;border-radius:999px;padding:13px 32px;font-family:'DM Sans',sans-serif;font-weight:500;font-size:15px;transition:all 0.2s;}
        .ghost-btn:hover{opacity:0.7;}
        .icon-btn{cursor:pointer;background:transparent;border:none;padding:8px;border-radius:50%;transition:opacity 0.2s;display:flex;align-items:center;justify-content:center;}
        .icon-btn:hover{opacity:0.55;}
        .seg-btn{cursor:pointer;border-radius:8px;padding:9px 14px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;transition:all 0.18s;border:none;flex:1;}
        .swatch{cursor:pointer;width:32px;height:32px;border-radius:50%;transition:all 0.18s;flex-shrink:0;border:3px solid transparent;}
      `}</style>

      {/* HOME */}
      {screen === "home" && (
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:32,padding:"44px 28px",maxWidth:440,width:"100%",textAlign:"center"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%"}}>
            <div style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:44,letterSpacing:"-0.02em"}}>
              brush<span style={{color:ac}}>feed</span>
            </div>
            <button className="icon-btn" onClick={()=>setScreen("settings")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={th.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>

          <p style={{fontFamily:"'Fraunces',serif",fontWeight:300,fontSize:20,lineHeight:1.55}}>
            2 minutes. No hands.<br/>
            <span style={{color:th.hint,fontSize:16}}>Fresh news while you brush.</span>
          </p>

          <div style={{display:"flex",flexDirection:"column",gap:12,width:"100%"}}>
            <p style={{color:th.hint,fontSize:12,textTransform:"uppercase",letterSpacing:"0.1em"}}>Pick your topics</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:10,justifyContent:"center"}}>
              {Object.entries(TOPIC_META).map(([key,val]) => (
                <button key={key} className="topic-btn"
                  style={{border:`2px solid ${topics.includes(key)?val.color:th.border}`,background:topics.includes(key)?`${val.color}18`:th.pill,color:topics.includes(key)?val.color:th.sub}}
                  onClick={()=>toggleTopic(key)}>
                  {val.emoji} {key}
                </button>
              ))}
            </div>
          </div>

          {loadError && (
            <div style={{background:"rgba(255,80,80,0.1)",border:"1px solid rgba(255,80,80,0.3)",borderRadius:12,padding:"12px 16px",fontSize:14,color:"#ff6b6b",width:"100%",textAlign:"left"}}>
              ⚠️ {loadError}
            </div>
          )}

          {loadingFirst ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14}}>
              <div style={{width:38,height:38,borderRadius:"50%",border:`3px solid ${th.track}`,borderTopColor:ac,animation:"spin 0.8s linear infinite"}}/>
              <p style={{color:th.sub,fontSize:15}}>Fetching today's news…</p>
              <p style={{color:th.hint,fontSize:13}}>Takes about 10 seconds</p>
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
              <button className="cta" disabled={topics.length===0}
                style={{background:ac,color:settings.theme==="dark"?"#0a0a10":"#1a1a1a"}}
                onClick={handleStart}>
                Start brushing →
              </button>
              <span style={{color:th.hint,fontSize:13}}>Real news · fresh every session</span>
            </div>
          )}

          {!loadingFirst && (
            <div style={{background:th.pill,borderRadius:12,padding:"11px 16px",display:"flex",gap:14,alignItems:"center",fontSize:13,color:th.sub,flexWrap:"wrap",justifyContent:"center"}}>
              <span>⏱ {settings.cardSpeed}s/card</span>
              <span style={{opacity:0.3}}>|</span>
              <span>🔤 {settings.fontSize}</span>
              <span style={{opacity:0.3}}>|</span>
              <span>🎨 {settings.theme}</span>
              <button className="ghost-btn" style={{color:ac,border:`1px solid ${ac}33`,padding:"4px 12px",fontSize:12}} onClick={()=>setScreen("settings")}>Edit</button>
            </div>
          )}
        </div>
      )}

      {/* FEED */}
      {screen === "feed" && current && (
        <div style={{display:"flex",flexDirection:"column",gap:16,padding:"28px 22px 36px",maxWidth:460,width:"100%",minHeight:"100vh",justifyContent:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:7,background:th.pill,borderRadius:999,padding:"6px 16px",flexShrink:0}}>
              <span style={{animation:"blink 1.4s infinite",color:ac,fontSize:9}}>●</span>
              <span style={{fontWeight:700,fontSize:19,color:th.text,letterSpacing:"0.04em"}}>{mins}:{secs}</span>
            </div>
            <div style={{flex:1,height:3,background:th.track,borderRadius:999,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${totalProgress*100}%`,background:`linear-gradient(90deg,${ac},${ACCENT_COLORS.pink})`,borderRadius:999,transition:"width 0.25s linear"}}/>
            </div>
            <span style={{fontSize:12,color:th.hint,flexShrink:0}}>{Math.min(currentIndex+1,totalCards)}/{totalCards}</span>
          </div>

          <div style={{alignSelf:"flex-start",border:`1.5px solid ${tMeta?.color||ac}`,borderRadius:999,padding:"4px 14px",fontSize:13,fontWeight:600,color:tMeta?.color||ac,letterSpacing:"0.04em",transition:"all 0.3s"}}>
            {tMeta?.emoji} {current.topic}
          </div>

          <div key={currentIndex} className="card-anim"
            style={{background:th.card,borderRadius:20,padding:"30px 26px 22px",borderLeft:`4px solid ${tMeta?.color||ac}`,display:"flex",flexDirection:"column",gap:14}}>
            <h2 style={{fontFamily:ff,fontWeight:700,fontSize:fs.title,lineHeight:1.25,color:th.text}}>{current.title}</h2>
            <p style={{fontFamily:"'DM Sans',sans-serif",fontWeight:300,fontSize:fs.body,lineHeight:1.8,color:th.sub}}>{current.body}</p>
            {current.source && (
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={th.hint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <span style={{fontSize:12,color:th.hint,fontStyle:"italic"}}>{current.source}</span>
              </div>
            )}
            <div style={{height:3,background:th.track,borderRadius:999,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${cardProgress*100}%`,background:tMeta?.color||ac,borderRadius:999,transition:"width 0.25s linear"}}/>
            </div>
          </div>

          {settings.showNextPreview && next && (
            <div style={{background:th.pill,borderRadius:14,padding:"14px 18px",display:"flex",flexDirection:"column",gap:5,border:`1px solid ${th.border}`}}>
              <span style={{color:nMeta?.color||ac,fontSize:11,fontWeight:600,letterSpacing:"0.07em",textTransform:"uppercase"}}>{nMeta?.emoji} Next up</span>
              <span style={{fontWeight:500,fontSize:15,color:th.hint}}>{next.title}</span>
            </div>
          )}

          <p style={{textAlign:"center",fontSize:13,color:th.hint}}>auto-advances every {settings.cardSpeed}s · no touching needed</p>
        </div>
      )}

      {/* DONE */}
      {screen === "done" && (
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:22,padding:"52px 28px",textAlign:"center",maxWidth:400}}>
          <div style={{fontSize:58}}>🦷</div>
          <h2 style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:44,color:th.text}}>All clean!</h2>
          <p style={{fontSize:18,color:th.sub,lineHeight:1.6}}>
            You read <span style={{color:ac,fontWeight:700}}>{Math.min(currentIndex+1,totalCards)} articles</span> in 2 minutes — hands free.
          </p>
          <div style={{display:"flex",flexDirection:"column",gap:12,alignItems:"center"}}>
            <button className="cta" style={{background:ac,color:settings.theme==="dark"?"#0a0a10":"#1a1a1a"}} onClick={handleStart}>Fresh feed →</button>
            <button className="ghost-btn" style={{color:th.sub,border:`1.5px solid ${th.border}`}} onClick={()=>setScreen("home")}>Change topics</button>
          </div>
        </div>
      )}

      {/* SETTINGS */}
      {screen === "settings" && (
        <div style={{display:"flex",flexDirection:"column",maxWidth:440,width:"100%",minHeight:"100vh"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"24px 24px 16px"}}>
            <button className="icon-btn" onClick={()=>setScreen("home")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={th.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
            </button>
            <h2 style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:26,color:th.text}}>Feed Style</h2>
          </div>
          <div style={{padding:"0 24px 48px",display:"flex",flexDirection:"column",gap:24}}>

            <SS label="Theme" th={th}>
              <div style={{display:"flex",gap:8}}>
                {["dark","light","sepia"].map(t=>(
                  <button key={t} className="seg-btn"
                    style={{background:settings.theme===t?ac:th.pill,color:settings.theme===t?(settings.theme==="dark"?"#0a0a10":"#fff"):th.sub,border:`1.5px solid ${settings.theme===t?ac:th.border}`}}
                    onClick={()=>updSetting("theme",t)}>
                    {t==="dark"?"🌙 Dark":t==="light"?"☀️ Light":"📜 Sepia"}
                  </button>
                ))}
              </div>
            </SS>

            <SS label="Accent colour" th={th}>
              <div style={{display:"flex",gap:12}}>
                {Object.entries(ACCENT_COLORS).map(([name,hex])=>(
                  <button key={name} className="swatch"
                    style={{background:hex,borderColor:settings.accentColor===name?hex:"transparent",boxShadow:settings.accentColor===name?`0 0 0 2px ${th.bg}, 0 0 0 4px ${hex}`:"none"}}
                    onClick={()=>updSetting("accentColor",name)} title={name}/>
                ))}
              </div>
            </SS>

            <SS label="Text size" th={th}>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                {["small","medium","large"].map(s=>(
                  <button key={s} className="seg-btn"
                    style={{background:settings.fontSize===s?ac:th.pill,color:settings.fontSize===s?(settings.theme==="dark"?"#0a0a10":"#fff"):th.sub,border:`1.5px solid ${settings.fontSize===s?ac:th.border}`,fontSize:s==="small"?12:s==="medium"?15:19}}
                    onClick={()=>updSetting("fontSize",s)}>A</button>
                ))}
              </div>
              <p style={{fontSize:12,color:th.hint}}>Preview: <span style={{fontSize:fs.body}}>The quick brown fox</span></p>
            </SS>

            <SS label="Font style" th={th}>
              <div style={{display:"flex",gap:8}}>
                {["sans","serif"].map(s=>(
                  <button key={s} className="seg-btn"
                    style={{background:settings.fontStyle===s?ac:th.pill,color:settings.fontStyle===s?(settings.theme==="dark"?"#0a0a10":"#fff"):th.sub,border:`1.5px solid ${settings.fontStyle===s?ac:th.border}`,fontFamily:s==="serif"?"'Fraunces',serif":"'DM Sans',sans-serif"}}
                    onClick={()=>updSetting("fontStyle",s)}>
                    {s==="sans"?"Sans-serif":"Serif"}
                  </button>
                ))}
              </div>
            </SS>

            <SS label={`Card speed — ${settings.cardSpeed}s per card`} th={th}>
              <input type="range" min={6} max={20} step={1} value={settings.cardSpeed}
                style={{width:"100%",accentColor:ac,cursor:"pointer"}}
                onChange={e=>updSetting("cardSpeed",Number(e.target.value))}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:th.hint,marginTop:4}}>
                <span>6s — fast reader</span><span>20s — relaxed</span>
              </div>
            </SS>

            <SS label="Show next card preview" th={th}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
                <span style={{fontSize:14,color:th.sub}}>Shows a peek at the next article</span>
                <div style={{width:46,height:26,borderRadius:999,background:settings.showNextPreview?ac:th.track,position:"relative",cursor:"pointer",transition:"background 0.2s",flexShrink:0}}
                  onClick={()=>updSetting("showNextPreview",!settings.showNextPreview)}>
                  <div style={{position:"absolute",top:3,left:settings.showNextPreview?23:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.25)"}}/>
                </div>
              </div>
            </SS>

            <div style={{background:`${ac}15`,border:`1px solid ${ac}40`,borderRadius:12,padding:"12px 16px",fontSize:14,color:ac,textAlign:"center"}}>
              ✓ Settings save automatically
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SS({ label, th, children }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <p style={{fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.09em",color:th.hint}}>{label}</p>
      <div style={{background:th.card,borderRadius:14,padding:"16px",border:`1px solid ${th.border}`}}>
        {children}
      </div>
    </div>
  );
}
