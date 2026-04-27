import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Trophy, Plus, Minus, ChevronLeft, ChevronRight, Play, RefreshCcw, Settings, Users, BarChart3, Award, Target, MapPin, Trash2, Save, FileDown, Share2, QrCode, Star, Camera } from 'lucide-react';
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
    { id: 1, name: 'Jugador 1', handicap: 0, photo: null },
    { id: 2, name: 'Jugador 2', handicap: 0, photo: null },
    { id: 3, name: 'Jugador 3', handicap: 0, photo: null },
    { id: 4, name: 'Jugador 4', handicap: 0, photo: null }
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
  const longPressTimerRef = useRef(null);
  const isLongPressRef = useRef(false);

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

  const setPlayerPhoto = (id, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      // Resize the image to a small thumbnail
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 120;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // Crop to square from center
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        setPlayers(prev => prev.map(p => (p.id === id ? { ...p, photo: dataUrl } : p)));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleExitPlaying = () => {
    if (window.confirm('¿Salir de la partida? Se perderán los datos de la partida en curso.')) {
      setScreen('setup');
    }
  };

  // === Course hole editing ===
  const setPar = (v) => { const h = [...course.holes]; h[holeIdx] = { ...h[holeIdx], par: Math.max(3, Math.min(6, v)) }; setCourse({ ...course, holes: h }); };
  const setHcp = (v) => { const h = [...course.holes]; h[holeIdx] = { ...h[holeIdx], handicap: Math.max(1, Math.min(18, v)) }; setCourse({ ...course, holes: h }); };

  // === Score management with numbered buttons ===
  const setScore = (pid, v) => {
    setScores(s => ({
      ...s,
      [hole.number]: { ...(s[hole.number] || {}), [pid]: v },
    }));
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
      newPlayers[slotIndex] = { ...newPlayers[slotIndex], name: savedP.name, handicap: savedP.handicap, photo: savedP.photo || null };
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
          updated.push({ id: Date.now() + Math.random(), name: p.name, handicap: p.handicap, photo: p.photo || null, isFavorite: false });
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
            <Settings size={22} /> <span>Partida de Golf by NicoSoft</span>
          </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {players.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {/* Photo avatar */}
                  <label style={{ cursor: 'pointer', flexShrink: 0 }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setPlayerPhoto(p.id, e.target.files[0])} />
                    <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: p.photo ? 'none' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '2px solid var(--primary)' }}>
                      {p.photo ? (
                        <img src={p.photo} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <Camera size={18} color="#94a3b8" />
                      )}
                    </div>
                  </label>
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
                          {sp.photo && (
                            <div style={{ width: '36px', height: '36px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                              <img src={sp.photo} alt={sp.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                          )}
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
  const totalPar = course.holes.slice(0, config.holes).reduce((s, h) => s + h.par, 0);

  if (screen === 'playing') {
    const hole = course.holes[holeIdx];

    return (
      <div className="app-container fade-in playing-screen">
        <header className="golf-tracker-header" style={{ padding: '0.5rem 0.75rem' }}>
          <button className="btn-icon" style={{ background: 'transparent', color: 'white', border: 'none', padding: '8px', minWidth: '40px', minHeight: '40px' }} onClick={handleExitPlaying}>
            <ChevronLeft size={24} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
            <button disabled={holeIdx === 0} onClick={(e) => { e.stopPropagation(); setHoleIdx(h => h - 1); }} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '10px 14px', borderRadius: '8px 0 0 8px', minHeight: '44px', opacity: holeIdx === 0 ? 0.3 : 1 }}>
              <ChevronLeft size={22} />
            </button>
            <div style={{ textAlign: 'center', padding: '6px 12px', background: 'rgba(255,255,255,0.08)', minHeight: '44px', display: 'flex', alignItems: 'center' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                H{hole.number} · P{hole.par} · HCP {hole.handicap}
              </div>
            </div>
            <button disabled={holeIdx === config.holes - 1} onClick={(e) => { e.stopPropagation(); setHoleIdx(h => h + 1); }} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '10px 14px', borderRadius: '0 8px 8px 0', minHeight: '44px', opacity: holeIdx === config.holes - 1 ? 0.3 : 1 }}>
              <ChevronRight size={22} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button className="btn-icon" style={{ background: 'transparent', color: 'white', border: 'none', padding: '8px', minWidth: '40px', minHeight: '40px' }} onClick={() => setScreen('results')} title="Ver Clasificación">
              <Trophy size={26} />
            </button>
            {matchId && (
              <button className="btn-icon" style={{ background: 'transparent', color: 'white', border: 'none', padding: '8px', minWidth: '40px', minHeight: '40px' }} onClick={() => setShowQr(true)} title="Compartir QR">
                <QrCode size={26} />
              </button>
            )}
          </div>
        </header>

        <main className="player-dashboard"
          onTouchStart={(e) => {
            const touch = e.touches[0];
            e.currentTarget._swipeStartY = touch.clientY;
          }}
          onTouchEnd={(e) => {
            const endY = e.changedTouches[0].clientY;
            const startY = e.currentTarget._swipeStartY || 0;
            if (startY - endY > 100) { // swipe up > 100px
              setScreen('results');
            }
          }}
        >
          {players.map((p, idx) => {
            const currentScore = scores[hole.number]?.[p.id] || 0;
            const diff = currentScore > 0 ? currentScore - hole.par : 0;
            const displayDiff = diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : diff);

            const handleTouchStart = (e) => {
              isLongPressRef.current = false;
              longPressTimerRef.current = setTimeout(() => {
                isLongPressRef.current = true;
                if (currentScore > 0) setScore(p.id, currentScore - 1);
              }, 500);
            };

            const handleTouchEnd = (e) => {
              clearTimeout(longPressTimerRef.current);
              if (isLongPressRef.current) {
                e.preventDefault(); // Prevent click from firing
                return;
              }
              // Normal tap = +1 stroke (auto-par on first tap)
              const newScore = currentScore === 0 ? hole.par : currentScore + 1;
              if (newScore <= 15) setScore(p.id, newScore);
            };

            const handleTouchMove = () => {
              clearTimeout(longPressTimerRef.current);
            };

            const handleClick = (e) => {
              // Desktop fallback: only if not triggered by touch
              if (!('ontouchstart' in window)) {
                const newScore = currentScore === 0 ? hole.par : currentScore + 1;
                if (newScore <= 15) setScore(p.id, newScore);
              }
            };

            const handleContextMenu = (e) => {
              e.preventDefault();
              // Desktop right-click fallback for -1
              if (currentScore > 0) setScore(p.id, currentScore - 1);
            };

            return (
              <div
                key={p.id}
                className={`player-card-v2 player-${idx % 4}`}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchMove}
              >
                <div className="player-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: p.photo ? 'none' : 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                      {p.photo ? (
                        <img src={p.photo} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <Users size={14} />
                      )}
                    </div>
                    <span>{p.name.toUpperCase()}</span>
                  </div>
                  <span>({p.handicap})</span>
                </div>

                <div className="player-card-body">
                  <div className="card-gross-score">{currentScore || 'P'}</div>
                  <div className="card-relative-score">{currentScore > 0 ? displayDiff : 'P'}</div>
                </div>

                <div className="player-card-footer">
                  <div>Total: {totals[p.id].strokes - totalPar > 0 ? `+${totals[p.id].strokes - totalPar}` : totals[p.id].strokes === 0 ? 'E' : totals[p.id].strokes - totalPar}</div>
                  <div>Stableford: {totals[p.id].netStableford} pts</div>
                </div>
              </div>
            );
          })}

          {/* Bottom hole navigation */}
          <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem', background: '#0f172a', flexShrink: 0 }}>
            <button
              disabled={holeIdx === 0}
              onClick={() => setHoleIdx(h => h - 1)}
              style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', background: holeIdx === 0 ? '#1e293b' : 'rgba(255,255,255,0.1)', border: 'none', color: holeIdx === 0 ? '#475569' : 'white', fontSize: '0.9rem', fontWeight: 700, cursor: holeIdx === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              <ChevronLeft size={20} /> Hoyo {hole.number - 1 || ''}
            </button>
            {holeIdx === config.holes - 1 ? (
              <button
                onClick={handleFinishMatch}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', background: 'var(--primary)', border: 'none', color: 'white', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                <Trophy size={20} /> Finalizar
              </button>
            ) : (
              <button
                onClick={() => setHoleIdx(h => h + 1)}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                Hoyo {hole.number + 1} <ChevronRight size={20} />
              </button>
            )}
          </div>
        </main>

        {showQr && matchId && (
          <div className="modal-overlay" onClick={() => setShowQr(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 0.5rem 0' }}>Compartir Partida</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1rem 0' }}>
                Escanea este código QR para unirte a la partida
              </p>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', display: 'inline-block' }}>
                <QRCodeSVG
                  value={`${window.location.origin}${window.location.pathname}?join=${matchId}`}
                  size={220}
                  level="H"
                />
              </div>
              <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                {`${window.location.origin}${window.location.pathname}?join=${matchId}`}
              </div>
              <button className="btn btn-secondary" style={{ marginTop: '1rem', width: '100%' }} onClick={() => setShowQr(false)}>
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ======================== RESULTS ========================
  // totalPar already computed above
  return (
    <div className="app-container fade-in">
      <header className="golf-tracker-header">
        <button className="btn btn-secondary" onClick={() => setScreen('playing')}>
          <ChevronLeft size={18} /> Volver (Hoyo {holeIdx + 1})
        </button>
      </header>
      <main className="content-area">
        <div id="results-pdf-area" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.5rem', background: '#f8fafc' }}>
          {/* PDF Report Header */}
          <div style={{ textAlign: 'center', borderBottom: '2px solid var(--primary)', paddingBottom: '1rem', marginBottom: '0.5rem' }}>
            <h1 style={{ margin: 0, fontSize: '1.75rem', color: 'var(--primary)', fontWeight: 900 }}>Informe de Partida de Golf</h1>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.5rem' }}>{config.name}</div>
            <div style={{ fontSize: '0.9rem', color: '#64748b', marginTop: '0.25rem' }}>Fecha: {config.date} | Campo: {course.name}</div>
          </div>

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
                      {p.name} (Hcp:{p.handicap})
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

