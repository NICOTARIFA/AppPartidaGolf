import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Trophy, Plus, Minus, ChevronLeft, ChevronRight, Play, RefreshCcw, Flag, Users, BarChart3, Award, Target, MapPin, Trash2, Save, FileDown, Share2, QrCode, Star } from 'lucide-react';
import defaultCourses from './defaultCourses.json';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { createClient } from '@supabase/supabase-js';
import { QRCodeSVG } from 'qrcode.react';

// Supabase configuration
const SUPABASE_URL = 'https://rulvzxpyeghfmyupnwka.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rOJfO6SqNkrcVv245JpInA_qywetcUE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
// ===== LOCAL STORAGE HELPERS =====
const COURSES_KEY = 'partidagolf_courses';
const COURSES_VERSION_KEY = 'partidagolf_courses_version';
const CURRENT_VERSION = '3'; // Increment when defaultCourses.json changes

function loadCourses() {
  try {
    const savedVersion = localStorage.getItem(COURSES_VERSION_KEY);
    const raw = localStorage.getItem(COURSES_KEY);

    if (raw && savedVersion === CURRENT_VERSION) {
      const saved = JSON.parse(raw);
      // Merge: keep default course IDs updated from JSON, preserve user-added courses
      const defaultIds = new Set(defaultCourses.map(c => c.id));
      const userCourses = saved.filter(c => !defaultIds.has(c.id));
      return [...defaultCourses, ...userCourses];
    }
  } catch (_) { /* ignore */ }

  // First load or version mismatch: use defaults and save them
  localStorage.setItem(COURSES_VERSION_KEY, CURRENT_VERSION);
  localStorage.setItem(COURSES_KEY, JSON.stringify(defaultCourses));
  return [...defaultCourses];
}

function saveCourses(courses) {
  localStorage.setItem(COURSES_KEY, JSON.stringify(courses));
  localStorage.setItem(COURSES_VERSION_KEY, CURRENT_VERSION);
}

// ===== SCORING HELPERS =====
function calcStableford(strokes, par, handicapStrokes = 0) {
  if (strokes <= 0) return 0;
  // Net strokes = Gross strokes - handicap strokes
  const netStrokes = strokes - handicapStrokes;
  const d = netStrokes - par;
  if (d <= -3) return 5;
  if (d === -2) return 4;
  if (d === -1) return 3;
  if (d === 0) return 2;
  if (d === 1) return 1;
  return 0;
}

function getHoleHandicapStrokes(playerHandicap, holeStrokeIndex) {
  if (!playerHandicap) return 0;
  const baseStrokes = Math.floor(playerHandicap / 18);
  const extraStroke = (playerHandicap % 18) >= holeStrokeIndex ? 1 : 0;
  return baseStrokes + extraStroke;
}

function scoreClass(strokes, par) {
  if (strokes <= 0) return '';
  const d = strokes - par;
  if (d <= -2) return 'score-eagle';
  if (d === -1) return 'score-birdie';
  if (d === 0) return 'score-par';
  if (d === 1) return 'score-bogey';
  return 'score-double';
}

function scoreName(strokes, par) {
  if (strokes <= 0) return '';
  const d = strokes - par;
  if (d <= -3) return 'Albatross!';
  if (d === -2) return 'Eagle!';
  if (d === -1) return 'Birdie';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'D. Bogey';
  return `+${d}`;
}

function calcMatchPlayWinner(holeScores) {
  if (!holeScores || Object.keys(holeScores).length === 0) return null;
  let min = Infinity, winners = [];
  Object.entries(holeScores).forEach(([pid, s]) => {
    if (s > 0) {
      if (s < min) { min = s; winners = [pid]; }
      else if (s === min) winners.push(pid);
    }
  });
  return winners.length === 1 ? winners[0] : null;
}

export default function App() {
  const [screen, setScreen] = useState('setup');
  const [courses, setCourses] = useState(loadCourses);
  const [selectedCourseId, setSelectedCourseId] = useState(courses[0]?.id || '');
  const [course, setCourse] = useState(courses[0] || { name: 'Nuevo Campo', holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, handicap: i + 1 })) });
  const [config, setConfig] = useState({
    name: 'Partida Amistosa',
    date: new Date().toISOString().split('T')[0],
    holes: 18,
    system: 'Stroke Play',
  });
  const [players, setPlayers] = useState([
    { id: 1, name: 'Jugador 1', handicap: 0 },
    { id: 2, name: 'Jugador 2', handicap: 0 },
    { id: 3, name: 'Jugador 3', handicap: 0 },
    { id: 4, name: 'Jugador 4', handicap: 0 }
  ]);
  const [holeIdx, setHoleIdx] = useState(0);
  const [selectedPlayerId, setSelectedPlayerId] = useState(1);
  const [scores, setScores] = useState({});
  const [matchId, setMatchId] = useState(null);
  const [showQr, setShowQr] = useState(false);
  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [savedPlayers, setSavedPlayers] = useState(() => {
    const raw = localStorage.getItem('partidagolf_saved_players');
    return raw ? JSON.parse(raw) : [];
  });
  const [playerFilter, setPlayerFilter] = useState('all'); // 'all' or 'fav'

  // Refs to avoid stale closures in real-time subscriptions
  const scoresRef = useRef(scores);
  const playersRef = useRef(players);
  const configRef = useRef(config);
  const lastPushTime = useRef(0);

  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { configRef.current = config; }, [config]);

  useEffect(() => {
    localStorage.setItem('partidagolf_saved_players', JSON.stringify(savedPlayers));
  }, [savedPlayers]);

  // Ensure selectedPlayerId is valid
  useEffect(() => {
    if (players.length > 0 && !players.find(p => p.id === selectedPlayerId)) {
      setSelectedPlayerId(players[0].id);
    }
  }, [players, selectedPlayerId]);

  // === URL Join Match ===
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get('join');
    if (joinId) {
      joinMatch(joinId);
      // Clean up URL without reloading
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Reset to player 1 when changing holes
  useEffect(() => {
    if (players.length > 0) {
      setSelectedPlayerId(players[0].id);
    }
  }, [holeIdx]);

  // Persist courses when they change
  useEffect(() => { saveCourses(courses); }, [courses]);

  // === Real-time sync ===
  useEffect(() => {
    if (!matchId) return;

    const channel = supabase
      .channel(`match:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload) => {
          if (payload.new) {
            // Only update if the server has a newer version than our last push
            // and the data is actually different
            const serverUpdatedAt = new Date(payload.new.updated_at).getTime();

            if (serverUpdatedAt > lastPushTime.current) {
              if (JSON.stringify(payload.new.scores) !== JSON.stringify(scoresRef.current)) {
                setScores(payload.new.scores);
              }
              if (JSON.stringify(payload.new.players) !== JSON.stringify(playersRef.current)) {
                setPlayers(payload.new.players);
              }
              if (JSON.stringify(payload.new.config) !== JSON.stringify(configRef.current)) {
                setConfig(payload.new.config);
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  // Push changes to Supabase
  useEffect(() => {
    if (!matchId) return;

    const pushChanges = async () => {
      // Don't push if we just received an update from the server
      const now = Date.now();
      lastPushTime.current = now;

      await supabase
        .from('matches')
        .update({
          config: configRef.current,
          players: playersRef.current,
          scores: scoresRef.current,
          updated_at: new Date(now).toISOString()
        })
        .eq('id', matchId);
    };

    const timer = setTimeout(pushChanges, 1500); // Slightly longer debounce to avoid collisions
    return () => clearTimeout(timer);
  }, [config, players, scores, matchId]);

  const hole = course.holes[holeIdx];

  // === Course management ===
  const selectCourse = (id) => {
    const c = courses.find(c => c.id === id);
    if (c) { setSelectedCourseId(id); setCourse(JSON.parse(JSON.stringify(c))); }
  };

  const saveCurrentCourse = () => {
    const idx = courses.findIndex(c => c.id === selectedCourseId);
    const updated = [...courses];
    if (idx >= 0) {
      updated[idx] = { ...course, id: selectedCourseId };
    } else {
      const newId = 'course-' + Date.now();
      updated.push({ ...course, id: newId });
      setSelectedCourseId(newId);
    }
    setCourses(updated);
  };

  const addNewCourse = () => {
    const newId = 'course-' + Date.now();
    const newCourse = {
      id: newId,
      name: 'Nuevo Campo',
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, handicap: i + 1 }))
    };
    setCourses([...courses, newCourse]);
    setSelectedCourseId(newId);
    setCourse(JSON.parse(JSON.stringify(newCourse)));
  };

  const deleteCourse = (id) => {
    if (courses.length <= 1) return;
    const updated = courses.filter(c => c.id !== id);
    setCourses(updated);
    if (selectedCourseId === id) { setSelectedCourseId(updated[0].id); setCourse(JSON.parse(JSON.stringify(updated[0]))); }
  };

  // === Player management ===
  const addPlayer = () => { if (players.length < 4) setPlayers([...players, { id: Date.now(), name: `Jugador ${players.length + 1}`, handicap: 0 }]); };
  const removePlayer = (id) => setPlayers(players.filter(p => p.id !== id));
  const renamePlayer = (id, name) => setPlayers(players.map(p => (p.id === id ? { ...p, name } : p)));
  const setPlayerHandicap = (id, handicap) => setPlayers(players.map(p => (p.id === id ? { ...p, handicap: parseInt(handicap) || 0 } : p)));

  // === Course hole editing ===
  const setPar = (v) => { const h = [...course.holes]; h[holeIdx] = { ...h[holeIdx], par: Math.max(3, Math.min(6, v)) }; setCourse({ ...course, holes: h }); };
  const setHcp = (v) => { const h = [...course.holes]; h[holeIdx] = { ...h[holeIdx], handicap: Math.max(1, Math.min(18, v)) }; setCourse({ ...course, holes: h }); };

  // === Score management with numbered buttons ===
  const setScore = (pid, v) => {
    setScores(s => ({
      ...s,
      [hole.number]: { ...(s[hole.number] || {}), [pid]: v },
    }));

    if (v > 0) {
      const pIdx = players.findIndex(p => p.id === pid);
      if (pIdx >= 0 && pIdx < players.length - 1) {
        setSelectedPlayerId(players[pIdx + 1].id);
      } else if (pIdx === players.length - 1 && holeIdx < config.holes - 1) {
        setHoleIdx(i => i + 1);
      }
    }
  };

  const toggleFavorite = (pid) => {
    setSavedPlayers(prev => prev.map(p => p.id === pid ? { ...p, isFavorite: !p.isFavorite } : p));
  };

  const deleteSavedPlayer = (pid) => {
    setSavedPlayers(prev => prev.filter(p => p.id !== pid));
  };

  const selectSavedPlayer = (savedP, slotIndex) => {
    setPlayers(prev => {
      const newPlayers = [...prev];
      newPlayers[slotIndex] = { ...newPlayers[slotIndex], name: savedP.name, handicap: savedP.handicap };
      return newPlayers;
    });
    setShowPlayerPicker(false);
  };

  const startNewMatch = async (online = false) => {
    setScores({});
    setHoleIdx(0);

    // Save current players to history if not exists
    setSavedPlayers(prev => {
      let updated = [...prev];
      players.forEach(p => {
        if (p.name && !updated.find(up => up.name.toLowerCase() === p.name.toLowerCase())) {
          updated.push({ id: Date.now() + Math.random(), name: p.name, handicap: p.handicap, isFavorite: false });
        }
      });
      return updated;
    });

    if (online) {
      const { data, error } = await supabase
        .from('matches')
        .insert([{ config, course, players, scores: {} }])
        .select();
      if (data && data[0]) {
        setMatchId(data[0].id);
      }
    } else {
      setMatchId(null);
    }
    setScreen('playing');
  };

  const joinMatch = async (id) => {
    if (!id) return;
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', id)
      .single();

    if (data) {
      setConfig(data.config);
      setCourse(data.course);
      setPlayers(data.players);
      setScores(data.scores);
      setMatchId(data.id);
      setScreen('playing');
    } else {
      alert("No se encontró la partida con ese ID.");
    }
  };


  // === Computed totals ===
  const totals = useMemo(() => {
    const t = {};
    players.forEach(p => (t[p.id] = { strokes: 0, netStrokes: 0, stableford: 0, netStableford: 0, matchPlay: 0 }));
    for (let i = 1; i <= config.holes; i++) {
      const hs = scores[i];
      if (!hs) continue;
      const h = course.holes[i - 1];
      players.forEach(p => {
        const s = hs[p.id] || 0;
        if (s > 0) {
          const hcpStrokes = getHoleHandicapStrokes(p.handicap, h.handicap);
          t[p.id].strokes += s;
          t[p.id].netStrokes += (s - hcpStrokes);
          t[p.id].stableford += calcStableford(s, h.par, 0);
          t[p.id].netStableford += calcStableford(s, h.par, hcpStrokes);
        }
      });
      const mpWin = calcMatchPlayWinner(hs);
      if (mpWin && t[mpWin]) t[mpWin].matchPlay += 1;
    }
    return t;
  }, [scores, players, config.holes, course]);

  const getDisplayScore = (pid) => {
    if (config.system === 'Stroke Play') return totals[pid].strokes;
    if (config.system === 'Stableford') return totals[pid].netStableford;
    if (config.system === 'Medal Play') return totals[pid].netStrokes;
    return totals[pid].matchPlay;
  };

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      if (config.system === 'Stroke Play') return (totals[a.id].strokes || Infinity) - (totals[b.id].strokes || Infinity);
      if (config.system === 'Stableford') return totals[b.id].netStableford - totals[a.id].netStableford;
      if (config.system === 'Medal Play') return (totals[a.id].netStrokes || Infinity) - (totals[b.id].netStrokes || Infinity);
      return totals[b.id].matchPlay - totals[a.id].matchPlay;
    });
  }, [totals, players, config.system]);

  const leaderId = useMemo(() => {
    if (sortedPlayers.length === 0) return null;
    const score = getDisplayScore(sortedPlayers[0].id);
    if (score === 0) return null;
    return sortedPlayers[0].id;
  }, [sortedPlayers, config.system, totals]);

  const scoreLabel = config.system === 'Stroke Play' ? 'Bruto' : config.system === 'Stableford' ? 'Puntos' : config.system === 'Medal Play' ? 'Neto' : 'Hoyos';


  const handleFinishMatch = () => {
    let missing = false;
    for (let i = 1; i <= config.holes; i++) {
      for (const p of players) {
        if (!scores[i] || !scores[i][p.id]) {
          missing = true;
          break;
        }
      }
      if (missing) break;
    }

    if (missing) {
      alert("Faltan resultados por rellenar. Completa las puntuaciones de todos los hoyos para todos los jugadores antes de finalizar la partida.");
      return;
    }
    setScreen('results');
  };

  const exportToPDF = async () => {
    const element = document.getElementById('results-pdf-area');
    if (!element) return;

    // Save original styles to restore them later
    const originalWidth = element.style.width;
    const originalMaxWidth = element.style.maxWidth;
    const scrollContainers = element.querySelectorAll('.scroll-x');
    const originalScrollStyles = [];

    // Force element to be wide enough to show all content without horizontal scroll
    element.style.width = 'max-content';
    element.style.maxWidth = 'none';
    scrollContainers.forEach(el => {
      originalScrollStyles.push(el.style.overflowX);
      el.style.overflowX = 'visible';
    });

    try {
      // Allow browser to apply styles before capture
      await new Promise(r => setTimeout(r, 100));

      const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#f8fafc' });
      const imgData = canvas.toDataURL('image/png');

      // Calculate dynamic PDF height based on aspect ratio
      const pdfWidth = 210; // A4 width in mm
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      const pdf = new jsPDF({
        orientation: pdfHeight > pdfWidth ? 'p' : 'l',
        unit: 'mm',
        format: [pdfWidth, pdfHeight]
      });

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`partida-${config.name.replace(/\s+/g, '-').toLowerCase()}-${config.date}.pdf`);
    } catch (err) {
      console.error('Error al generar PDF', err);
    } finally {
      // Restore original styles
      element.style.width = originalWidth;
      element.style.maxWidth = originalMaxWidth;
      scrollContainers.forEach((el, i) => {
        el.style.overflowX = originalScrollStyles[i];
      });
    }
  };

  // ======================== SETUP ========================
  if (screen === 'setup') {
    return (
      <div className="app-container fade-in">
        <header className="golf-tracker-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Flag size={22} /> <span>Partida de Golf by NicoSoft</span>
          </div>
          <div style={{ fontSize: '0.875rem', fontWeight: 500, opacity: 0.9 }}>Configuración</div>
        </header>
        <main className="content-area">
          <div className="card">
            <h2 className="card-title"><Target size={18} /> Detalles de la Partida</h2>
            <div className="form-group">
              <label>Nombre de la partida</label>
              <input className="input" value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Fecha</label>
              <input type="date" className="input" value={config.date} onChange={e => setConfig({ ...config, date: e.target.value })} />
            </div>
          </div>

          {/* Course selector */}
          <div className="card">
            <h2 className="card-title"><MapPin size={18} /> Seleccionar Campo</h2>
            <div className="course-list">
              {courses.map(c => (
                <div key={c.id} className={`course-item ${selectedCourseId === c.id ? 'selected' : ''}`} onClick={() => selectCourse(c.id)}>
                  <div>
                    <div className="course-item-name">{c.name}</div>
                    <div className="course-item-info">Par {c.holes.reduce((s, h) => s + h.par, 0)} · 18 hoyos</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 className="card-title"><Target size={18} /> Sistema de Juego</h2>
            <div className="form-group">
              <label>Modalidad</label>
              <select className="input" value={config.system} onChange={e => setConfig({ ...config, system: e.target.value })}>
                <option value="Stroke Play">Stroke Play (Bruto)</option>
                <option value="Medal Play">Medal Play (Neto)</option>
                <option value="Stableford">Stableford (Neto)</option>
                <option value="Match Play">Match Play</option>
              </select>
            </div>
          </div>

          {/* Players */}
          <div className="card">
            <div className="flex-between" style={{ marginBottom: '1rem' }}>
              <h2 className="card-title" style={{ margin: 0 }}><Users size={18} /> Jugadores</h2>
              <span className="system-badge">{players.length}/4</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {players.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input className="input" style={{ flex: 2 }} value={p.name} onChange={e => renamePlayer(p.id, e.target.value)} placeholder={`Jugador ${i + 1}`} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1.5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: '4px' }}>HCP</label>
                      <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--primary)', minWidth: '20px', textAlign: 'right' }}>{p.handicap}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="36"
                      step="1"
                      className="hcp-slider"
                      value={p.handicap}
                      onChange={e => setPlayerHandicap(p.id, e.target.value)}
                    />
                  </div>
                  <button className="btn-icon" style={{ background: '#f1f5f9', color: 'var(--primary)' }} onClick={() => setShowPlayerPicker(i)}>
                    <Users size={18} />
                  </button>
                  {players.length > 1 && (
                    <button className="btn-icon" style={{ background: 'var(--danger)', color: 'white', border: 'none', alignSelf: 'flex-end', marginBottom: '4px' }} onClick={() => removePlayer(p.id)}>
                      <Minus size={18} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {players.length < 4 && (
              <button className="btn btn-secondary" style={{ marginTop: '0.75rem' }} onClick={addPlayer}><Plus size={18} /> Añadir Jugador</button>
            )}
          </div>

          {showPlayerPicker !== false && (
            <div className="modal-overlay" onClick={() => setShowPlayerPicker(false)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="flex-between" style={{ marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0 }}>Seleccionar Jugador</h3>
                  <div className="flex-gap">
                    <button className={`btn-chip ${playerFilter === 'all' ? 'active' : ''}`} onClick={() => setPlayerFilter('all')}>Todos</button>
                    <button className={`btn-chip ${playerFilter === 'fav' ? 'active' : ''}`} onClick={() => setPlayerFilter('fav')}><Star size={14} /> Favs</button>
                  </div>
                </div>
                <div className="saved-players-list">
                  {savedPlayers.filter(sp => playerFilter === 'all' || sp.isFavorite).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No hay jugadores guardados</div>
                  ) : (
                    savedPlayers
                      .filter(sp => playerFilter === 'all' || sp.isFavorite)
                      .map(sp => (
                        <div key={sp.id} className="saved-player-item">
                          <div style={{ flex: 1 }} onClick={() => selectSavedPlayer(sp, showPlayerPicker)}>
                            <div style={{ fontWeight: 700 }}>{sp.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>HCP: {sp.handicap}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn-icon-sm" onClick={() => toggleFavorite(sp.id)}>
                              <Star size={16} fill={sp.isFavorite ? "var(--gold)" : "none"} color={sp.isFavorite ? "var(--gold)" : "currentColor"} />
                            </button>
                            <button className="btn-icon-sm" onClick={() => deleteSavedPlayer(sp.id)}>
                              <Trash2 size={16} color="var(--danger)" />
                            </button>
                          </div>
                        </div>
                      ))
                  )}
                </div>
                <button className="btn btn-secondary" style={{ marginTop: '1rem', width: '100%' }} onClick={() => setShowPlayerPicker(false)}>Cerrar</button>
              </div>
            </div>
          )}


          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button className="btn btn-primary" onClick={() => startNewMatch(false)}>
              <Play size={18} /> Empezar Localmente
            </button>
            <button className="btn btn-secondary" style={{ background: 'var(--accent)', color: 'white' }} onClick={() => startNewMatch(true)}>
              <Share2 size={18} /> Empezar Online (Compartido)
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ======================== PLAYING ========================
  if (screen === 'playing') {
    return (
      <div className="app-container fade-in playing-screen">
        <header className="golf-tracker-header">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>Marcador de Partida</span>
          </div>
          {matchId && (
            <button className="btn-icon" style={{ background: 'transparent', color: 'white' }} onClick={() => setShowQr(true)}>
              <QrCode size={22} />
            </button>
          )}
        </header>

        {showQr && (
          <div className="modal-overlay" onClick={() => setShowQr(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 style={{ marginBottom: '1rem', textAlign: 'center' }}>Escanear para unirse</h3>
              <div style={{ background: 'white', padding: '1rem', borderRadius: '0.5rem', display: 'flex', justifyContent: 'center' }}>
                <QRCodeSVG value={`${window.location.origin}${window.location.pathname}?join=${matchId}`} size={240} />
              </div>
              <button className="btn btn-secondary" style={{ marginTop: '1rem', width: '100%' }} onClick={() => setShowQr(false)}>
                Cerrar
              </button>
            </div>
          </div>
        )}

        <main className="playing-content">
          {/* Hole navigation */}
          <div className="hole-pills-container">
            {config.holes === 18 ? (
              <>
                <div className="hole-pills-row">
                  {course.holes.slice(0, 9).map((h, i) => (
                    <button
                      key={h.number}
                      className={`hole-pill ${holeIdx === i ? 'active' : ''}`}
                      onClick={() => setHoleIdx(i)}
                    >
                      {h.number}
                    </button>
                  ))}
                </div>
                <div className="hole-pills-row">
                  {course.holes.slice(9, 18).map((h, i) => (
                    <button
                      key={h.number}
                      className={`hole-pill ${holeIdx === i + 9 ? 'active' : ''}`}
                      onClick={() => setHoleIdx(i + 9)}
                    >
                      {h.number}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="hole-pills-row">
                {course.holes.slice(0, 9).map((h, i) => (
                  <button
                    key={h.number}
                    className={`hole-pill ${holeIdx === i ? 'active' : ''}`}
                    onClick={() => setHoleIdx(i)}
                  >
                    {h.number}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Player Tabs */}
          <div className="player-tabs-container">
            {players.map(p => {
              const currentStrokes = scores[hole.number]?.[p.id] || 0;
              const hcpStrokes = getHoleHandicapStrokes(p.handicap, hole.handicap);
              const holeStableford = calcStableford(currentStrokes, hole.par, hcpStrokes);

              return (
                <button
                  key={p.id}
                  className={`player-tab ${selectedPlayerId === p.id ? 'active' : ''}`}
                  onClick={() => setSelectedPlayerId(p.id)}
                >
                  <div className="player-tab-name">{p.name.length > 5 && p.name.toUpperCase().startsWith('JUGADOR') ? p.name.replace('ugador ', 'UG ') : p.name}</div>
                  <div className="player-tab-total">Total: {totals[p.id].strokes}</div>
                  <div className="player-tab-row">
                    <div><span>Golpes: {currentStrokes || '-'}</span></div>
                    <div><span>Stableford: {holeStableford}</span></div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Hole Info */}
          <div className="hole-info-bar">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 700 }}>Hoyo {hole.number}</span>
              <span style={{ fontSize: '0.85rem', color: 'rgba(0, 0, 0, 1)' }}>HCP {hole.handicap}</span>
            </div>
            <span>PAR {hole.par}</span>
          </div>

          {/* Score Input */}
          <div className="score-grid-large">
            <button
              className={`score-btn-lg score-btn-eagle ${scores[hole.number]?.[selectedPlayerId] === hole.par - 2 ? 'selected' : ''}`}
              onClick={() => setScore(selectedPlayerId, scores[hole.number]?.[selectedPlayerId] === hole.par - 2 ? 0 : hole.par - 2)}
            >
              <span className="score-btn-num">-2</span>
              <span className="score-btn-label">Eagle</span>
            </button>
            <button
              className={`score-btn-lg score-btn-birdie ${scores[hole.number]?.[selectedPlayerId] === hole.par - 1 ? 'selected' : ''}`}
              onClick={() => setScore(selectedPlayerId, scores[hole.number]?.[selectedPlayerId] === hole.par - 1 ? 0 : hole.par - 1)}
            >
              <span className="score-btn-num">-1</span>
              <span className="score-btn-label">Birdie</span>
            </button>
            <button
              className={`score-btn-lg score-btn-par ${scores[hole.number]?.[selectedPlayerId] === hole.par ? 'selected' : ''}`}
              onClick={() => setScore(selectedPlayerId, scores[hole.number]?.[selectedPlayerId] === hole.par ? 0 : hole.par)}
            >
              <span className="score-btn-num">E</span>
              <span className="score-btn-label">Par</span>
            </button>
            <button
              className={`score-btn-lg score-btn-bogey ${scores[hole.number]?.[selectedPlayerId] === hole.par + 1 ? 'selected' : ''}`}
              onClick={() => setScore(selectedPlayerId, scores[hole.number]?.[selectedPlayerId] === hole.par + 1 ? 0 : hole.par + 1)}
            >
              <span className="score-btn-num">+1</span>
              <span className="score-btn-label">Bogey</span>
            </button>
            <button
              className={`score-btn-lg score-btn-double ${scores[hole.number]?.[selectedPlayerId] === hole.par + 2 ? 'selected' : ''}`}
              onClick={() => setScore(selectedPlayerId, scores[hole.number]?.[selectedPlayerId] === hole.par + 2 ? 0 : hole.par + 2)}
            >
              <span className="score-btn-num">+2</span>
              <span className="score-btn-label">D. Bogey</span>
            </button>
            <button
              className={`score-btn-lg score-btn-triple ${scores[hole.number]?.[selectedPlayerId] === hole.par + 3 ? 'selected' : ''}`}
              onClick={() => setScore(selectedPlayerId, scores[hole.number]?.[selectedPlayerId] === hole.par + 3 ? 0 : hole.par + 3)}
              style={{ background: '#7c2d12' }}
            >
              <span className="score-btn-num">+3</span>
              <span className="score-btn-label">T. Bogey</span>
            </button>
            <button
              className={`score-btn-lg score-btn-other ${scores[hole.number]?.[selectedPlayerId] === hole.par + 4 ? 'selected' : ''}`}
              onClick={() => setScore(selectedPlayerId, scores[hole.number]?.[selectedPlayerId] === hole.par + 4 ? 0 : hole.par + 4)}
              style={{ background: '#451a03' }}
            >
              <span className="score-btn-num">+4</span>
              <span className="score-btn-label">+4</span>
            </button>
          </div>

          <div className="bottom-action-bar">
            <button className="btn-outline" onClick={() => setScreen('results')}>
              Ver clasificación total
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>

          {holeIdx === config.holes - 1 && (
            <div style={{ padding: '0 1rem 1rem' }}>
              <button className="btn btn-primary" onClick={handleFinishMatch}><Trophy size={18} /> Finalizar Partida</button>
            </div>
          )}
        </main>
      </div>
    );
  }

  // ======================== RESULTS ========================
  const totalPar = course.holes.slice(0, config.holes).reduce((s, h) => s + h.par, 0);
  return (
    <div className="app-container fade-in">
      <header className="golf-tracker-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Trophy size={22} /> <span>Resultados</span>
          <button className="btn btn-secondary" onClick={() => setScreen('playing')}>
            <ChevronLeft size={18} /> Volver al Juego (Hoyo {holeIdx + 1})
          </button>
        </div>
        <div style={{ fontSize: '0.875rem', fontWeight: 500, opacity: 0.9 }}>{config.name} · {config.date}</div>
      </header>
      <main className="content-area">
        <div id="results-pdf-area" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '10px' }}>
          <div className="winner-card">
            <div className="winner-trophy"><Trophy size={52} color="var(--gold)" /></div>
            <div className="winner-label">🏆 ¡Ganador!</div>
            <div className="winner-name">{leaderId ? players.find(p => p.id === leaderId)?.name : 'Empate'}</div>
            {leaderId && (
              <div style={{ marginTop: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', position: 'relative' }}>
                {getDisplayScore(leaderId)} {scoreLabel}{config.system === 'Stroke Play' && ` (Par ${totalPar})`}
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="card-title"><Award size={18} /> Clasificación</h2>
            <table className="scoreboard-table">
              <thead><tr><th style={{ width: '40px' }}>Pos</th><th>Jugador</th><th style={{ textAlign: 'right' }}>{scoreLabel}</th></tr></thead>
              <tbody>
                {sortedPlayers.map((p, i) => (
                  <tr key={p.id} className={i === 0 ? 'leader' : ''}>
                    <td><span className={`pos-badge ${i < 3 ? `pos-${i + 1}` : 'pos-other'}`}>{i + 1}</span></td>
                    <td style={{ fontWeight: i === 0 ? 700 : 400 }}>
                      {p.name}
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>Hcp: {p.handicap}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{getDisplayScore(p.id)}</div>
                      {config.system !== 'Match Play' && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                          {config.system === 'Stableford' ? `Bruto: ${totals[p.id].stableford} pts` : `Bruto: ${totals[p.id].strokes}`}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 className="card-title"><BarChart3 size={18} /> Detalle Hoyo a Hoyo</h2>
            <div className="scroll-x">
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>Hoyo</th><th>Par</th><th>Hcp</th>
                    {players.map(p => <th key={p.id}>{p.name.length > 8 ? p.name.slice(0, 7) + '…' : p.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {course.holes.slice(0, config.holes).map(h => (
                    <tr key={h.number}>
                      <td style={{ fontWeight: 600 }}>{h.number}</td>
                      <td>{h.par}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{h.handicap}</td>
                      {players.map(p => {
                        const s = scores[h.number]?.[p.id] || 0;
                        let display = '–';
                        let cls = '';
                        if (s > 0) {
                          const hcpStrokes = getHoleHandicapStrokes(p.handicap, h.handicap);
                          const net = s - hcpStrokes;

                          if (config.system === 'Stableford') {
                            display = calcStableford(s, h.par, hcpStrokes);
                          } else if (config.system === 'Medal Play') {
                            display = net;
                          } else {
                            display = s;
                          }
                          cls = scoreClass(s, h.par);
                        }
                        return (
                          <td key={p.id} className={cls}>
                            <div>{display}</div>
                            {s > 0 && config.system !== 'Stroke Play' && (
                              <div style={{ fontSize: '0.6rem', opacity: 0.6 }}>({s})</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="total-row" style={{ borderTop: '2px solid var(--primary)' }}>
                    <td colSpan="3">TOTAL BRUTO</td>
                    {players.map(p => (
                      <td key={p.id} style={{ fontWeight: 800 }}>{totals[p.id].strokes}</td>
                    ))}
                  </tr>
                  <tr className="total-row">
                    <td colSpan="3">TOTAL NETO</td>
                    {players.map(p => (
                      <td key={p.id} style={{ fontWeight: 800 }}>{totals[p.id].netStrokes}</td>
                    ))}
                  </tr>
                  <tr className="total-row">
                    <td colSpan="3">TOTAL STABLEFORD</td>
                    {players.map(p => (
                      <td key={p.id} style={{ fontWeight: 800, color: 'var(--primary)' }}>{totals[p.id].netStableford}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={exportToPDF}>
            <FileDown size={18} /> Descargar PDF
          </button>
          <button className="btn btn-primary" onClick={() => { setScreen('setup'); setHoleIdx(0); setScores({}); setMatchId(null); }}>
            <RefreshCcw size={18} /> Nueva Partida
          </button>
        </div>
      </main>
    </div>
  );
}

