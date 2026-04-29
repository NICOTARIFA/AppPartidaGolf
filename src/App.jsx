import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Trophy, Plus, Minus, ChevronLeft, ChevronRight, Play, RefreshCcw, Settings, Users, BarChart3, Award, Target, MapPin, Trash2, Save, FileDown, Share2, QrCode, Star, Camera, Edit3, Search, X, Flag, Gamepad2 } from 'lucide-react';
import defaultCourses from './defaultCourses.json';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { createClient } from '@supabase/supabase-js';
import { QRCodeSVG } from 'qrcode.react';

// Supabase configuration
const SUPABASE_URL = 'https://rulvzxpyeghfmyupnwka.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rOJfO6SqNkrcVv245JpInA_qywetcUE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
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

// Sindicato: 3 players, 6 points per hole based on net Stableford
function calcSindicatoPoints(holeStablefordScores) {
  // holeStablefordScores = [{ pid, pts }] sorted desc
  const sorted = [...holeStablefordScores].sort((a, b) => b.pts - a.pts);
  if (sorted.length !== 3) return {};

  const [a, b, c] = sorted;
  const result = {};

  if (a.pts === b.pts && b.pts === c.pts) {
    // All tied: 2-2-2
    result[a.pid] = 2; result[b.pid] = 2; result[c.pid] = 2;
  } else if (a.pts === b.pts) {
    // Tie first: 3-3-0
    result[a.pid] = 3; result[b.pid] = 3; result[c.pid] = 0;
  } else if (b.pts === c.pts) {
    // Tie second: 4-1-1
    result[a.pid] = 4; result[b.pid] = 1; result[c.pid] = 1;
  } else {
    // Clear: 4-2-0
    result[a.pid] = 4; result[b.pid] = 2; result[c.pid] = 0;
  }
  return result;
}

export default function App() {
  const [screen, setScreen] = useState('setup');
  const [courses, setCourses] = useState([]);
  const [courseFilter, setCourseFilter] = useState('favs');
  const [courseSearch, setCourseSearch] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [course, setCourse] = useState({ name: 'Nuevo Campo', holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, handicap: i + 1 })) });

  const fetchCourses = async () => {
    try {
      const { data, error } = await supabase.from('courses').select('*').order('name', { ascending: true });
      if (error) { console.error('Error fetching courses:', error); return; }

      if (data && data.length > 0) {
        setCourses(data);
        if (!selectedCourseId) {
          setSelectedCourseId(data[0].id);
          setCourse(data[0]);
        }
      } else {
        const toInsert = defaultCourses.map(({ id, ...rest }) => rest);
        const { data: inserted, error: insertError } = await supabase.from('courses').insert(toInsert).select();
        if (inserted && inserted.length > 0) {
          setCourses(inserted);
          if (!selectedCourseId) {
            setSelectedCourseId(inserted[0].id);
            setCourse(inserted[0]);
          }
        }
      }
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchCourses(); }, []);
  const [config, setConfig] = useState({
    name: 'Partida Amistosa',
    date: new Date().toISOString().split('T')[0],
    holes: 18,
    system: 'Stroke Play',
    tees: 'yellow' // 'yellow', 'red', or 'both'
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
  const [showHistory, setShowHistory] = useState(false);
  const [historyMatches, setHistoryMatches] = useState([]);
  const [flippedCards, setFlippedCards] = useState({});
  const [savedPlayers, setSavedPlayers] = useState(() => {
    const raw = localStorage.getItem('partidagolf_saved_players');
    return raw ? JSON.parse(raw) : [];
  });
  const [playerFilter, setPlayerFilter] = useState('fav');
  const [playerSearch, setPlayerSearch] = useState('');
  const [showPlayerForm, setShowPlayerForm] = useState(null); // null=closed, 'new'=create, or player object for edit
  const [playerFormData, setPlayerFormData] = useState({ name: '', surname: '', license_number: '', handicap: 0, photo: null });
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [courseFormData, setCourseFormData] = useState({ id: '', name: '', logo: null, holes: [] });

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

  // Load saved players from Supabase on mount (and migrate old non-UUID IDs)
  useEffect(() => {
    const loadFromSupabase = async () => {
      try {
        const { data, error } = await supabase.from('players').select('*').order('name');
        if (data && data.length > 0) {
          const mapped = data.map(p => ({
            id: p.id,
            name: p.name,
            surname: p.surname || '',
            license_number: p.license_number || '',
            handicap: p.handicap || 0,
            photo: p.photo || null,
            isFavorite: p.is_favorite || false,
          }));
          setSavedPlayers(mapped);
          localStorage.setItem('partidagolf_saved_players', JSON.stringify(mapped));
        } else {
          // No data in Supabase - migrate localStorage players to Supabase
          const local = JSON.parse(localStorage.getItem('partidagolf_saved_players') || '[]');
          if (local.length > 0) {
            const migrated = [];
            for (const p of local) {
              const newId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
              const dbRow = {
                id: newId,
                name: p.name || 'Sin nombre',
                surname: p.surname || '',
                license_number: p.license_number || '',
                handicap: p.handicap || 0,
                photo: p.photo || null,
                is_favorite: p.isFavorite || false,
              };
              await supabase.from('players').insert([dbRow]);
              migrated.push({ ...dbRow, isFavorite: dbRow.is_favorite });
            }
            setSavedPlayers(migrated);
            localStorage.setItem('partidagolf_saved_players', JSON.stringify(migrated));
          }
        }
      } catch (e) {
        console.warn('No se pudo cargar jugadores de Supabase, usando localStorage', e);
      }
    };
    loadFromSupabase();
  }, []);

  // Persist to localStorage whenever savedPlayers changes
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

  const openNewCourseForm = () => {
    setCourseFormData({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
      name: 'Nuevo Campo',
      logo: null,
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, handicap: i + 1, yellow: 0, red: 0 }))
    });
    setShowCourseForm(true);
  };

  const openEditCourseForm = (c) => {
    setCourseFormData(JSON.parse(JSON.stringify({
      ...c,
      holes: c.holes.map(h => ({ ...h, yellow: h.yellow || 0, red: h.red || 0 }))
    })));
    setShowCourseForm(true);
  };

  const saveCourseForm = async () => {
    let payload = { ...courseFormData };
    if (!payload.id || payload.id.startsWith('new-')) delete payload.id;

    try {
      if (payload.id) {
        const { data, error } = await supabase.from('courses').update(payload).eq('id', payload.id).select();
        if (!error && data) {
          setCourses(courses.map(c => c.id === payload.id ? data[0] : c));
          if (selectedCourseId === payload.id) setCourse(data[0]);
        }
      } else {
        const { data, error } = await supabase.from('courses').insert(payload).select();
        if (!error && data) setCourses([...courses, data[0]]);
      }
      setShowCourseForm(false);
    } catch (e) { console.error('Error saving course', e); }
  };

  const deleteCourseItem = async (id) => {
    if (courses.length <= 1) { alert("No puedes eliminar el único campo."); return; }
    if (!window.confirm("¿Eliminar este campo?")) return;

    try {
      const { error } = await supabase.from('courses').delete().eq('id', id);
      if (!error) {
        const updated = courses.filter(c => c.id !== id);
        setCourses(updated);
        if (selectedCourseId === id) {
          setSelectedCourseId(updated[0].id);
          setCourse(JSON.parse(JSON.stringify(updated[0])));
        }
      }
    } catch (e) { console.error(e); }
  };

  const toggleCourseFavorite = async (e, id, currentStatus) => {
    e.stopPropagation();
    try {
      const { data, error } = await supabase.from('courses').update({ is_favorite: !currentStatus }).eq('id', id).select();
      if (!error && data) setCourses(courses.map(c => c.id === id ? data[0] : c));
    } catch (e) { console.error(e); }
  };

  // === Player management ===
  const addPlayer = () => { if (players.length < 4) setPlayers([...players, { id: Date.now(), name: `Jugador ${players.length + 1}`, handicap: 0, photo: null }]); };
  const removePlayer = (id) => setPlayers(players.filter(p => p.id !== id));

  const handlePhotoFile = (file, callback) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 120;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        callback(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Open form to create new player
  const openNewPlayerForm = () => {
    setPlayerFormData({ name: '', surname: '', license_number: '', handicap: 0, photo: null });
    setShowPlayerForm('new');
  };

  // Open form to edit existing saved player
  const openEditPlayerForm = (sp) => {
    setPlayerFormData({ name: sp.name, surname: sp.surname || '', license_number: sp.license_number || '', handicap: sp.handicap || 0, photo: sp.photo || null });
    setShowPlayerForm(sp);
  };

  // Save player form (create or update) to Supabase
  const savePlayerForm = async () => {
    const { name, surname, license_number, handicap, photo } = playerFormData;
    if (!name.trim()) { alert('El nombre es obligatorio'); return; }

    if (showPlayerForm === 'new') {
      // Create new
      const newId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const dbRow = { id: newId, name: name.trim(), surname, license_number, handicap, photo, is_favorite: false };
      const { error } = await supabase.from('players').insert([dbRow]);
      if (error) { console.error('Error creating player', error); alert('Error al guardar: ' + error.message); return; }
      const newLocal = { id: newId, name: name.trim(), surname, license_number, handicap, photo, isFavorite: false };
      setSavedPlayers(prev => [...prev, newLocal]);
    } else {
      // Update existing
      const pid = showPlayerForm.id;
      const { error } = await supabase.from('players').update({
        name: name.trim(), surname, license_number, handicap, photo, updated_at: new Date().toISOString(),
      }).eq('id', pid);
      if (error) { console.error('Error updating player', error); alert('Error al actualizar: ' + error.message); return; }
      setSavedPlayers(prev => prev.map(p => p.id === pid ? { ...p, name: name.trim(), surname, license_number, handicap, photo } : p));
      // Also update in active players if they're using this saved player
      setPlayers(prev => prev.map(p => p.savedPlayerId === pid ? { ...p, name: name.trim(), surname, license_number, handicap, photo } : p));
    }
    setShowPlayerForm(null);
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
    setSavedPlayers(prev => {
      const updated = prev.map(p => p.id === pid ? { ...p, isFavorite: !p.isFavorite } : p);
      // Sync to Supabase
      const player = updated.find(p => p.id === pid);
      if (player) {
        supabase.from('players').update({ is_favorite: player.isFavorite }).eq('id', pid).then();
      }
      return updated;
    });
  };

  const deleteSavedPlayer = (pid) => {
    setSavedPlayers(prev => prev.filter(p => p.id !== pid));
    // Delete from Supabase
    supabase.from('players').delete().eq('id', pid).then();
  };

  const selectSavedPlayer = (savedP, slotIndex) => {
    setPlayers(prev => {
      const newPlayers = [...prev];
      newPlayers[slotIndex] = {
        ...newPlayers[slotIndex],
        name: savedP.name,
        surname: savedP.surname || '',
        license_number: savedP.license_number || '',
        handicap: savedP.handicap,
        photo: savedP.photo || null,
        savedPlayerId: savedP.id, // link to DB record
      };
      return newPlayers;
    });
    setShowPlayerPicker(false);
  };

  const openHistory = async () => {
    setShowHistory(true);
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) {
      setHistoryMatches(data);
    }
  };

  const loadMatch = (m) => {
    setConfig(m.config);
    setCourse(m.course);
    setPlayers(m.players);
    setScores(m.scores || {});
    setMatchId(m.id);
    setShowHistory(false);

    let missing = false;
    for (let i = 1; i <= m.config.holes; i++) {
      for (const p of m.players) {
        if (!m.scores[i] || !m.scores[i][p.id]) {
          missing = true;
          break;
        }
      }
      if (missing) break;
    }

    if (!missing) {
      setScreen('results');
    } else {
      setScreen('playing');
    }
  };

  const startNewMatch = async (online = false) => {
    setScores({});
    setHoleIdx(0);

    const { data, error } = await supabase
      .from('matches')
      .insert([{ config, course, players, scores: {} }])
      .select();
    if (data && data[0]) {
      setMatchId(data[0].id);
      if (online) {
        setShowQr(true);
      }
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
    players.forEach(p => (t[p.id] = { strokes: 0, netStrokes: 0, stableford: 0, netStableford: 0, matchPlay: 0, sindicato: 0 }));
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

      // Sindicato calculation per hole (both modes)
      const isSindicato = config.system === 'Sindicato' || config.system === 'Sindicato Bruto';
      if (isSindicato && players.length === 3) {
        const useHandicap = config.system === 'Sindicato'; // net mode
        const holeStableford = players.map(p => {
          const s = hs[p.id] || 0;
          const hcpStrokes = useHandicap ? getHoleHandicapStrokes(p.handicap, course.holes[i - 1].handicap) : 0;
          return { pid: p.id, pts: s > 0 ? calcStableford(s, course.holes[i - 1].par, hcpStrokes) : 0 };
        });
        // Only calculate if all 3 have scored
        if (holeStableford.every(x => (hs[players.find(pl => pl.id === x.pid)?.id] || 0) > 0)) {
          const sinPoints = calcSindicatoPoints(holeStableford);
          Object.entries(sinPoints).forEach(([pid, pts]) => {
            if (t[pid]) t[pid].sindicato += pts;
          });
        }
      }
    }
    return t;
  }, [scores, players, config.holes, config.system, course]);

  const getDisplayScore = (pid) => {
    if (config.system === 'Stroke Play') return totals[pid].strokes;
    if (config.system === 'Stableford') return totals[pid].netStableford;
    if (config.system === 'Medal Play') return totals[pid].netStrokes;
    if (config.system === 'Sindicato' || config.system === 'Sindicato Bruto') return totals[pid].sindicato;
    return totals[pid].matchPlay;
  };

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      if (config.system === 'Stroke Play') return (totals[a.id].strokes || Infinity) - (totals[b.id].strokes || Infinity);
      if (config.system === 'Stableford') return totals[b.id].netStableford - totals[a.id].netStableford;
      if (config.system === 'Medal Play') return (totals[a.id].netStrokes || Infinity) - (totals[b.id].netStrokes || Infinity);
      if (config.system === 'Sindicato' || config.system === 'Sindicato Bruto') return totals[b.id].sindicato - totals[a.id].sindicato;
      return totals[b.id].matchPlay - totals[a.id].matchPlay;
    });
  }, [totals, players, config.system]);

  const leaderId = useMemo(() => {
    if (sortedPlayers.length === 0) return null;
    const score = getDisplayScore(sortedPlayers[0].id);
    if (score === 0) return null;
    return sortedPlayers[0].id;
  }, [sortedPlayers, config.system, totals]);

  const scoreLabel = config.system === 'Stroke Play' ? 'Bruto' : config.system === 'Stableford' ? 'Puntos' : config.system === 'Medal Play' ? 'Neto' : (config.system === 'Sindicato' || config.system === 'Sindicato Bruto') ? 'Sindicato' : 'Hoyos';


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

  const filteredCourses = useMemo(() => {
    let filtered = courses;
    if (courseFilter === 'favs') {
      filtered = filtered.filter(c => c.is_favorite);
    }
    if (courseSearch) {
      const q = courseSearch.toLowerCase();
      filtered = filtered.filter(c => c.name.toLowerCase().includes(q));
    }
    return filtered;
  }, [courses, courseFilter, courseSearch]);

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
            <div className="form-group">
              <h2 className="card-title"><Target size={18} /> Detalles de la Partida</h2>
              <input className="input" placeholder="Nombre de la Partida" value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })} />
            </div>
            <div className="form-group">
              <input type="date" className="input" placeholder="Fecha" value={config.date} onChange={e => setConfig({ ...config, date: e.target.value })} />
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button className="btn btn-secondary" onClick={openHistory}>
                <RefreshCcw size={18} /> Historial de Partidas
              </button>
            </div>
          </div>



          {/* Course selector */}
          <div className="card">
            <div className="flex-between" style={{ marginBottom: '1rem' }}>
              <h2 className="card-title" style={{ margin: 0 }}><MapPin size={18} /> Campos</h2>
              <button className="btn" style={{ background: '#22c55e', color: 'white', padding: '6px 16px', fontSize: '0.95rem', fontWeight: 'bold', border: 'none', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: 'auto', width: 'auto' }} onClick={openNewCourseForm}><Plus size={16} />&nbsp;&nbsp;Nuevo&nbsp;&nbsp;</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              <div style={{ position: 'relative' }}>
                <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                <input type="text" className="input" placeholder="Buscar por nombre..." style={{ paddingLeft: '2.2rem' }} value={courseSearch} onChange={e => setCourseSearch(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className={`btn-chip ${courseFilter === 'all' ? 'active' : ''}`} onClick={() => setCourseFilter('all')}>Todos</button>
                <button className={`btn-chip ${courseFilter === 'favs' ? 'active' : ''}`} onClick={() => setCourseFilter('favs')}>Favoritos</button>
              </div>
            </div>

            <div className="course-list" style={{ maxHeight: '250px', overflowY: 'auto' }}>
              {filteredCourses.map(c => (
                <div key={c.id} className={`course-item ${selectedCourseId === c.id ? 'selected' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem' }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }} onClick={() => selectCourse(c.id)}>
                    {c.logo ? (
                      <img src={c.logo} alt="Logo" style={{ width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(15,23,42,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <MapPin size={20} color="var(--primary)" />
                      </div>
                    )}
                    <div>
                      <div className="course-item-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {c.name}
                        {c.is_favorite && <Star size={14} color="#facc15" fill="#facc15" />}
                      </div>
                      <div className="course-item-info">Par {c.holes.reduce((s, h) => s + h.par, 0)} · 18 hoyos</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button className="btn-icon-sm" onClick={(e) => toggleCourseFavorite(e, c.id, c.is_favorite)}>
                      <Star size={16} color={c.is_favorite ? '#facc15' : 'var(--text-muted)'} fill={c.is_favorite ? '#facc15' : 'none'} />
                    </button>
                    <button className="btn-icon-sm" onClick={(e) => { e.stopPropagation(); openEditCourseForm(c); }}><Edit3 size={16} color="var(--primary)" /></button>
                    <button className="btn-icon-sm" onClick={(e) => { e.stopPropagation(); deleteCourseItem(c.id); }}><Trash2 size={16} color="var(--danger)" /></button>
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
                <option value="Sindicato">Sindicato con Handicap (3 Jug.)</option>
                <option value="Sindicato Bruto">Sindicato sin Handicap (3 Jug.)</option>
              </select>
            </div>
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label>Barras de Salida</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className={`btn-chip ${config.tees === 'yellow' ? 'active' : ''}`}
                  onClick={() => setConfig({ ...config, tees: 'yellow' })}
                  style={{ flex: 1, justifyContent: 'center', background: config.tees === 'yellow' ? '#facc15' : 'transparent', color: config.tees === 'yellow' ? '#854d0e' : 'inherit', border: config.tees === 'yellow' ? 'none' : '1px solid #cbd5e1', padding: '0.35rem 0.25rem' }}
                >
                  Amarillas
                </button>
                <button
                  className={`btn-chip ${config.tees === 'red' ? 'active' : ''}`}
                  onClick={() => setConfig({ ...config, tees: 'red' })}
                  style={{ flex: 1, justifyContent: 'center', background: config.tees === 'red' ? '#ef4444' : 'transparent', color: config.tees === 'red' ? 'white' : 'inherit', border: config.tees === 'red' ? 'none' : '1px solid #cbd5e1', padding: '0.35rem 0.25rem' }}
                >
                  Rojas
                </button>
                <button
                  className={`btn-chip ${config.tees === 'both' ? 'active' : ''}`}
                  onClick={() => setConfig({ ...config, tees: 'both' })}
                  style={{ flex: 1, justifyContent: 'center', background: config.tees === 'both' ? '#64748b' : 'transparent', color: config.tees === 'both' ? 'white' : 'inherit', border: config.tees === 'both' ? 'none' : '1px solid #cbd5e1', padding: '0.35rem 0.25rem' }}
                >
                  Ambas
                </button>
              </div>
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
                <div key={p.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.5rem', background: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: p.photo ? 'none' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '2px solid var(--primary)', flexShrink: 0 }}>
                    {p.photo ? (
                      <img src={p.photo} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Users size={16} color="#94a3b8" />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}{p.surname ? ` ${p.surname}` : ''}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem' }}>
                      <span>HCP: {p.handicap}</span>
                      {p.license_number && <span>· Lic: {p.license_number}</span>}
                    </div>
                  </div>
                  <button className="btn-icon" style={{ background: '#f1f5f9', color: 'var(--primary)' }} onClick={() => { setPlayerFilter('fav'); setShowPlayerPicker(i); }}>
                    <Users size={18} />
                  </button>
                  {players.length > 1 && (
                    <button className="btn-icon" style={{ background: 'var(--danger)', color: 'white', border: 'none' }} onClick={() => removePlayer(p.id)}>
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

          {/* Player Picker Modal with Search */}
          {showPlayerPicker !== false && (
            <div className="modal-overlay" onClick={() => { setShowPlayerPicker(false); setPlayerSearch(''); }}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="flex-between" style={{ marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0 }}>Seleccionar Jugador</h3>
                  <button className="btn-icon-sm" onClick={() => { setShowPlayerPicker(false); setPlayerSearch(''); }}>
                    <X size={20} />
                  </button>
                </div>
                <form style={{ position: 'relative', marginBottom: '0.75rem' }} onSubmit={e => e.preventDefault()}>
                  <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="search"
                    className="input"
                    style={{ paddingLeft: '34px', width: '100%' }}
                    placeholder="Buscar..."
                    value={playerSearch}
                    onChange={e => setPlayerSearch(e.target.value)}
                    autoComplete="off"
                    enterKeyHint="search"
                    onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                  />
                </form>
                {/* Filter chips */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '2px' }}>
                  <button className={`btn-chip ${playerFilter === 'all' ? 'active' : ''}`} style={{ flexShrink: 0 }} onClick={() => setPlayerFilter('all')}>Todos</button>
                  <button className={`btn-chip ${playerFilter === 'fav' ? 'active' : ''}`} style={{ flexShrink: 0 }} onClick={() => setPlayerFilter('fav')}><Star size={14} /> Favs</button>
                  <button className="btn-chip active" style={{ marginLeft: 'auto', background: 'var(--primary)', color: 'white', flexShrink: 0 }} onClick={openNewPlayerForm}><Plus size={14} /> Nuevo</button>
                </div>
                <div className="saved-players-list">
                  {(() => {
                    const q = playerSearch.toLowerCase().trim();
                    const filtered = savedPlayers
                      .filter(sp => playerFilter === 'all' || sp.isFavorite)
                      .filter(sp => !q || sp.name.toLowerCase().includes(q) || (sp.surname || '').toLowerCase().includes(q));
                    return filtered.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        {q ? 'Sin resultados' : 'No hay jugadores guardados'}
                      </div>
                    ) : (
                      filtered.map(sp => (
                        <div key={sp.id} className="saved-player-item" style={{ alignItems: 'flex-start' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                            {sp.photo ? (
                              <div style={{ width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden' }}>
                                <img src={sp.photo} alt={sp.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              </div>
                            ) : (
                              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Users size={16} color="#94a3b8" />
                              </div>
                            )}
                            <button className="btn-icon-sm" style={{ width: '28px', height: '28px' }} onClick={() => toggleFavorite(sp.id)}>
                              <Star size={14} fill={sp.isFavorite ? "var(--gold)" : "none"} color={sp.isFavorite ? "var(--gold)" : "currentColor"} />
                            </button>
                          </div>

                          <div style={{ flex: 1, cursor: 'pointer', minWidth: 0, padding: '0 0.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', marginTop: '2px' }} onClick={() => { selectSavedPlayer(sp, showPlayerPicker); setPlayerSearch(''); }}>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: '1.2', marginBottom: '0.35rem' }}>{sp.name}{sp.surname ? ` ${sp.surname}` : ''}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span>HCP: {sp.handicap}</span>
                              {sp.license_number && <span>· Lic: {sp.license_number}</span>}
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <button className="btn-icon-sm" onClick={() => openEditPlayerForm(sp)}>
                              <Edit3 size={16} color="var(--primary)" />
                            </button>
                            <button className="btn-icon-sm" onClick={() => deleteSavedPlayer(sp.id)}>
                              <Trash2 size={16} color="var(--danger)" />
                            </button>
                          </div>
                        </div>
                      ))
                    );
                  })()}
                </div>
                <button className="btn btn-secondary" style={{ marginTop: '1rem', width: '100%' }} onClick={() => { setShowPlayerPicker(false); setPlayerSearch(''); }}>Cerrar</button>
              </div>
            </div>
          )}

          {showHistory && (
            <div className="modal-overlay" onClick={() => setShowHistory(false)}>
              <div className="modal-content" style={{ maxWidth: '600px', height: '90vh', display: 'flex', flexDirection: 'column', padding: '1rem' }} onClick={e => e.stopPropagation()}>
                <div className="flex-between" style={{ marginBottom: '1rem', flexShrink: 0 }}>
                  <h3 style={{ margin: 0 }}>Historial de Partidas</h3>
                  <button className="btn-icon-sm" onClick={() => setShowHistory(false)}><X size={20} /></button>
                </div>
                <div style={{ overflowY: 'auto', paddingRight: '0.5rem', flex: 1 }}>
                  {historyMatches.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No hay partidas registradas.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {historyMatches.map(m => (
                        <div key={m.id} className="card" style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '12px', background: '#f8fafc', margin: 0 }}>
                          <div className="flex-between" style={{ marginBottom: '0.5rem' }}>
                            <strong style={{ color: 'var(--primary)' }}>{m.config.name || 'Partida sin nombre'}</strong>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(m.created_at).toLocaleDateString()}</span>
                          </div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                            <div><strong>Campo:</strong> {m.course.name}</div>
                            <div><strong>Modalidad:</strong> {m.config.system} ({m.config.holes} Hoyos)</div>
                            <div><strong>Jugadores:</strong> {m.players.map(p => p.name).join(', ')}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn btn-primary btn-sm" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => loadMatch(m)}>
                              Cargar Partida
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Player Form Modal (Create / Edit) */}
          {showPlayerForm && (
            <div className="modal-overlay" onClick={() => setShowPlayerForm(null)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="flex-between" style={{ marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0 }}>{showPlayerForm === 'new' ? 'Nuevo Jugador' : 'Editar Jugador'}</h3>
                  <button className="btn-icon-sm" onClick={() => setShowPlayerForm(null)}>
                    <X size={20} />
                  </button>
                </div>
                {/* Photo */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                  <label style={{ cursor: 'pointer' }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handlePhotoFile(e.target.files[0], (dataUrl) => setPlayerFormData(prev => ({ ...prev, photo: dataUrl })))} />
                    <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: playerFormData.photo ? 'none' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '3px solid var(--primary)' }}>
                      {playerFormData.photo ? (
                        <img src={playerFormData.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <Camera size={28} color="#94a3b8" />
                      )}
                    </div>
                  </label>
                </div>
                {/* Fields */}
                <div className="form-group">
                  <label>Nombre *</label>
                  <input className="input" value={playerFormData.name} onChange={e => setPlayerFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="Nombre" autoFocus />
                </div>
                <div className="form-group">
                  <label>Apellidos</label>
                  <input className="input" value={playerFormData.surname} onChange={e => setPlayerFormData(prev => ({ ...prev, surname: e.target.value }))} placeholder="Apellidos" />
                </div>
                <div className="form-group">
                  <label>Nº Licencia Federativa</label>
                  <input className="input" value={playerFormData.license_number} onChange={e => setPlayerFormData(prev => ({ ...prev, license_number: e.target.value }))} placeholder="Nº Licencia" />
                </div>
                <div className="form-group">
                  <label>Handicap: <strong style={{ color: 'var(--primary)' }}>{playerFormData.handicap}</strong></label>
                  <input type="range" min="0" max="54" step="1" className="hcp-slider" value={playerFormData.handicap} onChange={e => setPlayerFormData(prev => ({ ...prev, handicap: parseInt(e.target.value) || 0 }))} />
                </div>
                <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} onClick={savePlayerForm}>
                  <Save size={18} /> {showPlayerForm === 'new' ? 'Crear Jugador' : 'Guardar Cambios'}
                </button>
              </div>
            </div>
          )}


          {/* Course Form Modal */}
          {showCourseForm && (
            <div className="modal-overlay" onClick={() => setShowCourseForm(false)}>
              <div className="modal-content" style={{ maxWidth: '600px', height: '90vh', display: 'flex', flexDirection: 'column', padding: '1rem' }} onClick={e => e.stopPropagation()}>
                <div className="flex-between" style={{ marginBottom: '1rem', flexShrink: 0 }}>
                  <h3 style={{ margin: 0 }}>{courseFormData.id ? 'Editar Campo' : 'Nuevo Campo'}</h3>
                  <button className="btn-icon-sm" onClick={() => setShowCourseForm(false)}><X size={20} /></button>
                </div>
                <div style={{ overflowY: 'auto', paddingRight: '0.5rem', flex: 1 }}>
                  {/* Photo/Logo */}
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                    <label style={{ cursor: 'pointer' }}>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handlePhotoFile(e.target.files[0], (dataUrl) => setCourseFormData(prev => ({ ...prev, logo: dataUrl })))} />
                      <div style={{ width: '80px', height: '80px', borderRadius: '12px', background: courseFormData.logo ? 'none' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '3px solid var(--primary)' }}>
                        {courseFormData.logo ? (
                          <img src={courseFormData.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <Camera size={28} color="#94a3b8" />
                        )}
                      </div>
                    </label>
                  </div>
                  <div className="form-group">
                    <label>Nombre del Campo *</label>
                    <input className="input" value={courseFormData.name} onChange={e => setCourseFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="Nombre del campo" />
                  </div>
                  <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Hoyos (18)</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {courseFormData.holes.map((h, i) => (
                      <div key={i} style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', background: '#f8fafc', padding: '0.5rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontWeight: 800, width: '20px', textAlign: 'center', color: 'var(--primary)' }}>{h.number}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                          <label style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Par</label>
                          <input type="number" min="3" max="6" className="input" style={{ padding: '0.25rem' }} value={h.par} onChange={e => { const holes = [...courseFormData.holes]; holes[i].par = parseInt(e.target.value) || 3; setCourseFormData({ ...courseFormData, holes }); }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                          <label style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>HCP</label>
                          <input type="number" min="1" max="18" className="input" style={{ padding: '0.25rem' }} value={h.handicap} onChange={e => { const holes = [...courseFormData.holes]; holes[i].handicap = parseInt(e.target.value) || 1; setCourseFormData({ ...courseFormData, holes }); }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1.2 }}>
                          <label style={{ fontSize: '0.6rem', color: '#ca8a04' }}>Am. (m)</label>
                          <input type="number" min="0" className="input" style={{ padding: '0.25rem' }} value={h.yellow} onChange={e => { const holes = [...courseFormData.holes]; holes[i].yellow = parseInt(e.target.value) || 0; setCourseFormData({ ...courseFormData, holes }); }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1.2 }}>
                          <label style={{ fontSize: '0.6rem', color: '#dc2626' }}>Ro. (m)</label>
                          <input type="number" min="0" className="input" style={{ padding: '0.25rem' }} value={h.red} onChange={e => { const holes = [...courseFormData.holes]; holes[i].red = parseInt(e.target.value) || 0; setCourseFormData({ ...courseFormData, holes }); }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem', flexShrink: 0 }} onClick={saveCourseForm}>
                  <Save size={18} /> Guardar Campo
                </button>
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
        <header className="golf-tracker-header" style={{ padding: '0.4rem 0.5rem', display: 'flex', alignItems: 'stretch', gap: '0.5rem', justifyContent: 'space-between' }}>
          {/* Left Button: Fin */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '0 12px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, height: '100%', cursor: 'pointer' }} onClick={handleExitPlaying}>
              Fin
            </button>
          </div>

          {/* Compact Hole Navigation inside Header */}
          <div style={{ display: 'flex', gap: '4px', flex: 1, justifyContent: 'center', maxWidth: '240px' }}>
            {/* 1. HOYO */}
            <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column', width: '42px', flexShrink: 0 }}>
              <div style={{ background: 'var(--primary)', color: 'white', fontWeight: 800, fontSize: '0.55rem', textAlign: 'center', padding: '2px 0' }}>HOYO</div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', fontWeight: 900, color: 'white' }}>
                {hole.number}
              </div>
            </div>

            {/* 2. BARRAS */}
            <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column', width: '42px', flexShrink: 0 }}>
              <div style={{ background: 'var(--primary)', color: 'white', fontWeight: 800, fontSize: '0.5rem', textAlign: 'center', padding: '2px 0' }}>BARRAS</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '4px 0' }}>
                {(config.tees === 'both' || config.tees === 'yellow') && (
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#facc15', boxShadow: '0 0 4px rgba(250,204,21,0.5)' }}></div>
                )}
                {(config.tees === 'both' || config.tees === 'red') && (
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 4px rgba(239,68,68,0.5)' }}></div>
                )}
              </div>
            </div>

            {/* 3. PAR */}
            <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column', width: '36px', flexShrink: 0 }}>
              <div style={{ background: 'var(--primary)', color: 'white', fontWeight: 800, fontSize: '0.55rem', textAlign: 'center', padding: '2px 0' }}>PAR</div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', fontWeight: 800, color: 'white' }}>
                {hole.par}
              </div>
            </div>

            {/* 4. HCP */}
            <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column', width: '36px', flexShrink: 0 }}>
              <div style={{ background: 'var(--primary)', color: 'white', fontWeight: 800, fontSize: '0.55rem', textAlign: 'center', padding: '2px 0' }}>HCP</div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', fontWeight: 800, color: 'white' }}>
                {hole.handicap}
              </div>
            </div>

            {/* 5. DISTANCIA (Bandera) */}
            <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minWidth: '40px' }}>
              <div style={{ background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px 0' }}>
                <Flag size={12} color="white" />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '2px', padding: '2px 0', fontSize: '1rem', fontWeight: 800, color: 'white' }}>
                {(config.tees === 'both' || config.tees === 'yellow') && (
                  <div>{hole.yellow ? `${hole.yellow}m` : '-'}</div>
                )}
                {(config.tees === 'both' || config.tees === 'red') && (
                  <div>{hole.red ? `${hole.red}m` : '-'}</div>
                )}
              </div>
            </div>
          </div>

          {/* Right Buttons: Trophy, QR */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button className="btn-icon" style={{ background: 'transparent', color: 'white', border: 'none', padding: '4px', minWidth: '36px', height: '100%' }} onClick={() => setScreen('results')} title="Ver Clasificación">
              <Trophy size={20} />
            </button>
            {matchId && (
              <button className="btn-icon" style={{ background: 'transparent', color: 'white', border: 'none', padding: '4px', minWidth: '36px', height: '100%' }} onClick={() => setShowQr(true)} title="Compartir QR">
                <QrCode size={20} />
              </button>
            )}
          </div>
        </header>

        <main className="player-dashboard">
          {players.map((p, idx) => {
            const currentScore = scores[hole.number]?.[p.id] || 0;
            const diff = currentScore > 0 ? currentScore - hole.par : 0;
            const displayDiff = diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : diff);
            const isFlipped = flippedCards[p.id] || false;

            const handleTouchStart = (e) => {
              isLongPressRef.current = false;
              const touch = e.touches[0];
              e.currentTarget._startX = touch.clientX;
              e.currentTarget._startY = touch.clientY;

              longPressTimerRef.current = setTimeout(() => {
                isLongPressRef.current = true;
                if (currentScore > 0 && !isFlipped) setScore(p.id, currentScore - 1);
              }, 500);
            };

            const handleTouchEnd = (e) => {
              clearTimeout(longPressTimerRef.current);
              if (isLongPressRef.current) {
                e.preventDefault();
                return;
              }

              const touch = e.changedTouches[0];
              const deltaX = touch.clientX - e.currentTarget._startX;
              const deltaY = touch.clientY - e.currentTarget._startY;

              if (Math.abs(deltaX) > 40 && Math.abs(deltaY) < 40) {
                if (deltaX < 0) {
                  setFlippedCards(prev => ({ ...prev, [p.id]: true }));
                } else {
                  setFlippedCards(prev => ({ ...prev, [p.id]: false }));
                }
                e.preventDefault();
                return;
              }

              if (isFlipped) return;

              const newScore = currentScore === 0 ? hole.par : currentScore + 1;
              if (newScore <= 15) setScore(p.id, newScore);
            };

            const handleTouchMove = () => {
              clearTimeout(longPressTimerRef.current);
            };

            const handleClick = (e) => {
              if (isFlipped) return;
              if (!('ontouchstart' in window)) {
                const newScore = currentScore === 0 ? hole.par : currentScore + 1;
                if (newScore <= 15) setScore(p.id, newScore);
              }
            };

            const handleContextMenu = (e) => {
              e.preventDefault();
              if (isFlipped) return;
              if (currentScore > 0) setScore(p.id, currentScore - 1);
            };

            return (
              <div
                key={p.id}
                className={`player-card-v2 ${isFlipped ? '' : `player-${idx % 4}`}`}
                style={{
                  ...(isFlipped ? { background: '#F2F0C9', color: '#000000', border: '2px solid #d69e2e', minHeight: '240px' } : {})
                }}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchMove}
              >
                <div className="player-card-header" style={{
                  background: isFlipped ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.12)',
                  borderBottom: isFlipped ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.2)',
                  color: isFlipped ? '#000000' : '#ffffff',
                  padding: '0.25rem 0.5rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: p.photo ? 'none' : (isFlipped ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)'), display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                        {p.photo ? (
                          <img src={p.photo} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <Users size={12} color={isFlipped ? '#000000' : '#ffffff'} />
                        )}
                      </div>
                      <span style={{ color: isFlipped ? '#000000' : '#ffffff', fontWeight: 800, fontSize: '0.75rem' }}>{p.name.toUpperCase()} ({p.handicap})</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px', opacity: 0.95 }}>
                      <span style={{ color: isFlipped ? '#000000' : '#ffffff', fontSize: '0.62rem', fontWeight: 600 }}>
                        Stableford Scratch: {totals[p.id].stableford} pts
                      </span>
                      <span style={{ color: isFlipped ? '#000000' : '#ffffff', fontSize: '0.62rem', fontWeight: 600 }}>
                        Stableford Neto: {totals[p.id].netStableford} pts
                      </span>
                    </div>
                  </div>
                </div>

                {isFlipped ? (
                  <div className="player-card-detail" style={{ padding: '0.5rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
                    {(() => {
                      const renderPart = (start, end) => {
                        const holesSlice = course.holes.slice(start, end);
                        let sumPar = 0, sumGol = 0, sumNet = 0, sumStb = 0, sumScr = 0;

                        holesSlice.forEach(h => {
                          sumPar += h.par || 0;
                          const s = scores[h.number]?.[p.id] || 0;
                          if (s > 0) {
                            sumGol += s;
                            const hcpStrokes = getHoleHandicapStrokes(p.handicap, h.handicap);
                            sumNet += (s - hcpStrokes);
                            sumStb += calcStableford(s, h.par, hcpStrokes);
                            sumScr += calcStableford(s, h.par, 0);
                          }
                        });

                        return (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem', color: '#000000' }}>
                            <thead>
                              <tr style={{ background: 'rgba(0,0,0,0.05)' }}>
                                <th style={{ textAlign: 'left', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 800, width: '32px' }}>H</th>
                                {holesSlice.map(h => (
                                  <th key={`th-${h.number}`} style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 800 }}>{h.number}</th>
                                ))}
                                <th style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 800, width: '32px' }}>Tot</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td style={{ textAlign: 'left', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 800 }}>Par</td>
                                {holesSlice.map(h => (
                                  <td key={`par-${h.number}`} style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 600 }}>{h.par}</td>
                                ))}
                                <td style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 800 }}>{sumPar}</td>
                              </tr>
                              <tr>
                                <td style={{ textAlign: 'left', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 800 }}>Gol</td>
                                {holesSlice.map(h => {
                                  const s = scores[h.number]?.[p.id] || 0;
                                  let scoreBg = 'transparent';
                                  let scoreColor = '#000000';
                                  let isCircle = false;
                                  if (s > 0) {
                                    const d = s - h.par;
                                    if (d <= -2) { scoreBg = '#3b82f6'; scoreColor = '#ffffff'; isCircle = true; }
                                    else if (d === -1) { scoreBg = '#ef4444'; scoreColor = '#ffffff'; isCircle = true; }
                                    else if (d === 0) { scoreBg = 'transparent'; scoreColor = '#000000'; }
                                    else if (d === 1) { scoreBg = '#1e3a8a'; scoreColor = '#ffffff'; }
                                    else { scoreBg = '#374151'; scoreColor = '#ffffff'; }
                                  }
                                  return (
                                    <td key={`gol-${h.number}`} style={{ textAlign: 'center', padding: '2px', border: '1px solid rgba(0,0,0,0.15)' }}>
                                      {s > 0 ? (
                                        <span style={{
                                          background: scoreBg,
                                          color: scoreColor,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          width: '18px',
                                          height: '18px',
                                          borderRadius: isCircle ? '50%' : '3px',
                                          fontWeight: 800
                                        }}>{s}</span>
                                      ) : '–'}
                                    </td>
                                  );
                                })}
                                <td style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 800 }}>{sumGol > 0 ? sumGol : '–'}</td>
                              </tr>
                              <tr>
                                <td style={{ textAlign: 'left', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 600 }}>Net</td>
                                {holesSlice.map(h => {
                                  const s = scores[h.number]?.[p.id] || 0;
                                  const hcpStrokes = getHoleHandicapStrokes(p.handicap, h.handicap);
                                  const net = s > 0 ? s - hcpStrokes : '–';
                                  return <td key={`net-${h.number}`} style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)' }}>{net}</td>;
                                })}
                                <td style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 800 }}>{sumNet !== 0 ? sumNet : '–'}</td>
                              </tr>
                              <tr>
                                <td style={{ textAlign: 'left', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 600 }}>Stb</td>
                                {holesSlice.map(h => {
                                  const s = scores[h.number]?.[p.id] || 0;
                                  const hcpStrokes = getHoleHandicapStrokes(p.handicap, h.handicap);
                                  const stb = s > 0 ? calcStableford(s, h.par, hcpStrokes) : '–';
                                  return <td key={`stb-${h.number}`} style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)' }}>{stb}</td>;
                                })}
                                <td style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 800 }}>{sumStb}</td>
                              </tr>
                              <tr>
                                <td style={{ textAlign: 'left', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 600 }}>Scr</td>
                                {holesSlice.map(h => {
                                  const s = scores[h.number]?.[p.id] || 0;
                                  const scr = s > 0 ? calcStableford(s, h.par, 0) : '–';
                                  return <td key={`scr-${h.number}`} style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)' }}>{scr}</td>;
                                })}
                                <td style={{ textAlign: 'center', padding: '3px', border: '1px solid rgba(0,0,0,0.15)', fontWeight: 800 }}>{sumScr}</td>
                              </tr>
                            </tbody>
                          </table>
                        );
                      };
                      return (
                        <>
                          {renderPart(0, Math.min(9, config.holes))}
                          {config.holes > 9 && renderPart(9, Math.min(18, config.holes))}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <>
                    <div className="player-card-body">
                      <div className="card-gross-score">{currentScore || 'P'}</div>
                      <div className="card-relative-score">{currentScore > 0 ? displayDiff : 'P'}</div>
                    </div>

                    <div className="player-card-footer">
                      <div>Golpes Brutos: {totals[p.id].strokes}</div>
                      <div>Netos : {totals[p.id].strokes-[p.id].handicap}</div>
                      {(config.system === 'Sindicato' || config.system === 'Sindicato Bruto') ? (
                        <div>Sindicato: {totals[p.id].sindicato} pts</div>
                      ) : (
                        <div>Stableford Neto: {totals[p.id].netStableford} pts</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Hole Progress Bar */}
          <div style={{ display: 'flex', width: '100%', gap: '2px', padding: '4px 4px 0 4px', background: '#0f172a', flexShrink: 0 }}>
            {Array.from({ length: 18 }).map((_, i) => {
              // Si el hoyo ya fue pasado (i < holeIdx) o es el actual (i === holeIdx), en verde. Resto en gris.
              const isPlayed = i <= holeIdx;
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: '3px',
                    borderRadius: '1px',
                    background: isPlayed ? 'var(--primary)' : '#334155',
                    transition: 'background 0.3s ease'
                  }}
                />
              );
            })}
          </div>

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
          <div style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid var(--primary)', paddingBottom: '1rem', marginBottom: '0.5rem' }}>
            {course.logo && (
              <div style={{ flexShrink: 0, marginRight: '1rem' }}>
                <img src={course.logo} alt="Logo del campo" style={{ width: '60px', height: '60px', borderRadius: '8px', objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ flex: 1, textAlign: 'center' }}>
              <h1 style={{ margin: 0, fontSize: '1.75rem', color: 'var(--primary)', fontWeight: 900 }}>Informe de Partida de Golf</h1>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.5rem' }}>{config.name}</div>
              <div style={{ fontSize: '0.9rem', color: '#64748b', marginTop: '0.25rem' }}>Fecha: {config.date} | Campo: {course.name}</div>
            </div>
            {course.logo && <div style={{ width: '60px', marginLeft: '1rem' }}></div>} {/* Spacer for centering */}
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
                      <td style={{ fontWeight: 800 }}>{h.number}</td>
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

