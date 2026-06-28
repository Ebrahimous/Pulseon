import React, { useMemo, useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Image, Animated,
  TextInput, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { captureRef } from '../utils/capture';
import { useGameStore } from '../store/gameStore';
import { generateEcgSvg } from '../utils/ecgRenderer';
import { submitScore } from '../utils/leaderboard';

// Persist player name across runs (web only)
const NAME_KEY = 'pulse_player_name';
function loadSavedName() {
  try { return (typeof localStorage !== 'undefined' && localStorage.getItem(NAME_KEY)) || ''; }
  catch { return ''; }
}
function saveNameLocally(n) {
  try { typeof localStorage !== 'undefined' && localStorage.setItem(NAME_KEY, n); }
  catch {}
}

// ── Grade ─────────────────────────────────────────────────────────────────────
function calcGrade(survivalMs, bestCombo) {
  const t = survivalMs / 1000;  // seconds
  const g = t * bestCombo;      // combined performance metric
  if (g >= 600) return 'S';     // e.g. 60s × ×10 combo
  if (g >= 150) return 'A';
  if (g >= 40)  return 'B';
  if (g >= 10)  return 'C';
  return 'D';
}

const GRADE_COLOR = { S: '#FFD700', A: '#69FF47', B: '#4FC3F7', C: '#FFFFFF', D: '#555' };

export default function DeathScreen({ navigation }) {
  const screenRef = useRef(null);

  // Heart entrance animation
  const heartScale   = useRef(new Animated.Value(1.6)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(heartScale,   { toValue: 1.0, duration: 520, useNativeDriver: true }),
      Animated.timing(heartOpacity, { toValue: 1.0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, []);

  // Leaderboard submit state
  const [playerName,  setPlayerName]  = useState(loadSavedName);
  const [submitState, setSubmitState] = useState('idle'); // idle | submitting | done | error

  const {
    ecgHistory, score, bestScore, zone, peakBpm, lowestBpm,
    survivalMs, bestCombo, deathCause, ringsDodged, resetGame,
    runStreak, bestStreak,
  } = useGameStore();

  const isFlatline = deathCause === 'flatline';
  const isArrest   = deathCause === 'arrest';
  const causeColor = isFlatline ? '#4FC3F7' : '#FF1744';
  const causeLabel = isFlatline ? 'FLATLINED' : isArrest ? 'OVERDRIVE' : 'BURNED OUT';
  const causeDesc  = isFlatline ? 'you lost the rhythm'
                   : isArrest   ? 'you pushed too far'
                   : 'you burned too bright';

  const grade      = calcGrade(survivalMs, bestCombo);
  const gradeColor = GRADE_COLOR[grade];

  // ── New best glow — pulses gold on the name input when this run beats the record ──
  const isNewBest   = bestScore > 10 && score >= bestScore;
  const newBestGlow = useRef(new Animated.Value(0)).current;
  const newBestLoop = useRef(null);
  useEffect(() => {
    if (isNewBest && submitState === 'idle') {
      newBestLoop.current = Animated.loop(Animated.sequence([
        Animated.timing(newBestGlow, { toValue: 1,    duration: 650, useNativeDriver: false }),
        Animated.timing(newBestGlow, { toValue: 0.15, duration: 650, useNativeDriver: false }),
      ]));
      newBestLoop.current.start();
    } else {
      newBestLoop.current?.stop();
      newBestGlow.setValue(0);
    }
    return () => newBestLoop.current?.stop();
  }, [isNewBest, submitState]);

  const handleSubmit = async () => {
    const trimmed = playerName.trim();
    if (!trimmed) return;
    setSubmitState('submitting');
    saveNameLocally(trimmed);
    const ok = await submitScore({
      name:       trimmed,
      score,
      survivalMs,
      grade,
      zoneName:   zone.label,
      bestCombo,
    });
    setSubmitState(ok ? 'done' : 'error');
  };

  const svgString = useMemo(() => generateEcgSvg({
    ecgHistory, score, deathCause,
    zoneName: zone.label,
    peakBpm, lowestBpm, survivalMs,
  }), [ecgHistory, score, deathCause, zone, peakBpm, survivalMs]);

  const survivalSec   = Math.floor(survivalMs / 1000);
  const minutes       = Math.floor(survivalSec / 60);
  const seconds       = survivalSec % 60;
  const survivalLabel = `${minutes}:${String(seconds).padStart(2, '0')}`;
  const scoreLabel    = Math.floor(score).toLocaleString();

  const handleShare = async () => {
    // Web: pure canvas draw (no external images → no tainted-canvas errors)
    if (Platform.OS === 'web') {
      try {
        const W = 390, H = 520;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        // Branding
        ctx.fillStyle = '#181818';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('P U L S E', W / 2, 38);

        // Cause of death
        ctx.fillStyle = causeColor;
        ctx.font = '18px monospace';
        ctx.fillText(causeLabel, W / 2, 74);

        // BPM history line (drawn directly — no SVG, no taint risk)
        if (ecgHistory && ecgHistory.length >= 2) {
          const PAD = 32;
          const graphW = W - PAD * 2;
          const graphH = 120;
          const graphY = 100;
          const tStart = ecgHistory[0].t;
          const tRange = Math.max(ecgHistory[ecgHistory.length - 1].t - tStart, 1);
          ctx.strokeStyle = zone.color + '55';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ecgHistory.forEach((p, i) => {
            const x = PAD + ((p.t - tStart) / tRange) * graphW;
            const norm = Math.max(0, Math.min(1, (p.bpm - 40) / 120));
            const y = graphY + graphH - norm * graphH;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          });
          ctx.stroke();
          // Baseline
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(PAD, graphY + graphH + 4);
          ctx.lineTo(W - PAD, graphY + graphH + 4);
          ctx.stroke();
        }

        // Grade
        ctx.fillStyle = gradeColor;
        ctx.font = '80px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(grade, 32, 360);

        // Score
        ctx.fillStyle = gradeColor;
        ctx.font = '34px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(scoreLabel, W - 32, 334);

        // Stats
        ctx.fillStyle = '#555';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${survivalLabel}  ·  ×${bestCombo}  ·  ${ringsDodged} rings`, W / 2, 410);

        // Zone
        ctx.fillStyle = zone.color;
        ctx.font = '10px monospace';
        ctx.fillText(zone.label.toUpperCase(), W / 2, 440);

        // Footer
        ctx.fillStyle = '#181818';
        ctx.fillText(window.location.hostname, W / 2, 505);

        // toDataURL is synchronous and safe (no external images loaded)
        const dataUrl = canvas.toDataURL('image/png');
        const fetchRes = await fetch(dataUrl);
        const blob = await fetchRes.blob();
        const file = new File([blob], 'pulse_run.png', { type: 'image/png' });

        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Pulse' });
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'pulse_run.png';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      } catch (e) {
        // Last-resort: copy text to clipboard
        const text = `Pulse · ${causeLabel} · Grade ${grade} · ${scoreLabel} pts · ${survivalLabel}`;
        try {
          await navigator.clipboard.writeText(text);
          Alert.alert('Copied', 'Result copied to clipboard.');
        } catch {}
        console.error('Share error', e);
      }
      return;
    }

    // Native: capture screen as PNG and share
    try {
      const uri = await captureRef(screenRef, { format: 'png', quality: 0.95 });
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Share your Pulse run',
        });
      } else {
        const dest = FileSystem.cacheDirectory + 'pulse_run.png';
        await FileSystem.copyAsync({ from: uri, to: dest });
        Alert.alert('Saved', 'Screenshot saved.');
      }
    } catch (e) {
      console.error('Share error', e);
      Alert.alert('Share failed', String(e?.message ?? e));
    }
  };

  const handleRestart = () => {
    resetGame();
    navigation.replace('Start');
  };

  return (
    <View ref={screenRef} style={styles.container} collapsable={false}>

      {/* Header: heart + cause + zone */}
      <View style={styles.header}>
        <Animated.Image
          source={require('../../Assets/Heart.png')}
          style={[styles.heartImg, { tintColor: causeColor, transform: [{ scale: heartScale }], opacity: heartOpacity }]}
          resizeMode="contain"
        />
        <Text style={[styles.causeLabel, { color: causeColor }]}>{causeLabel}</Text>
        <Text style={styles.causeSubtitle}>
          {causeDesc}
          {'  ·  '}
          <Text style={{ color: zone.color }}>{zone.label.toUpperCase()}</Text>
        </Text>
      </View>

      {/* ECG waveform */}
      <View style={styles.svgContainer}>
        <SvgXml xml={svgString} width="100%" height="100%" />
      </View>

      {/* Grade + Score */}
      <View style={styles.gradeRow}>
        <Text style={[styles.gradeLetter, { color: gradeColor }]}>{grade}</Text>
        <View style={styles.gradeInfo}>
          <Text style={[styles.scoreDisplay, { color: gradeColor }]}>{scoreLabel}</Text>
          {bestScore > 10 && (
            <Text style={[styles.bestLabel, { color: score >= bestScore ? '#FFD700' : '#333' }]}>
              BEST {Math.floor(bestScore).toLocaleString()}
            </Text>
          )}
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <Stat label="TIME"   value={survivalLabel} />
        <Stat label="PEAK"   value={`${peakBpm}`} />
        <Stat label="COMBO"  value={`×${bestCombo}`} accent={zone.color} />
        <Stat label="DODGED" value={`${ringsDodged}`} />
      </View>

      {/* Streak */}
      {(runStreak > 1 || bestStreak > 1) && (
        <View style={styles.streakRow}>
          {runStreak > 0 && (
            <Text style={[styles.streakText, runStreak >= 3 && { color: '#FFD700' }]}>
              {runStreak}  RUN STREAK
            </Text>
          )}
          {bestStreak > runStreak && bestStreak > 1 && (
            <Text style={styles.streakBest}>BEST  {bestStreak}</Text>
          )}
        </View>
      )}

      {/* Leaderboard submit */}
      {submitState !== 'done' ? (
        <View style={{ width: '100%', marginBottom: 12 }}>
          {isNewBest && submitState === 'idle' && (
            <Animated.Text style={[styles.newBestPrompt, { opacity: newBestGlow }]}>
              NEW BEST — ENTER YOUR NAME
            </Animated.Text>
          )}
          <View style={styles.submitRow}>
            <Animated.View style={[
              styles.nameInputWrap,
              isNewBest && submitState === 'idle' && {
                borderColor: newBestGlow.interpolate({
                  inputRange:  [0.15, 1],
                  outputRange: ['#1a1a1a', '#FFD700'],
                }),
              },
            ]}>
              <TextInput
                style={styles.nameInputField}
                placeholder="YOUR NAME"
                placeholderTextColor="#333"
                value={playerName}
                onChangeText={setPlayerName}
                maxLength={20}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                editable={submitState !== 'submitting'}
              />
            </Animated.View>
            <TouchableOpacity
              style={[styles.submitBtn, submitState === 'submitting' && { opacity: 0.5 }]}
              onPress={handleSubmit}
              disabled={submitState === 'submitting' || !playerName.trim()}
            >
              <Text style={styles.submitBtnText}>
                {submitState === 'submitting' ? '...' : submitState === 'error' ? 'RETRY' : 'SUBMIT'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={styles.submittedText}>POSTED TO LEADERBOARD ✓</Text>
      )}

      {/* Actions — side by side */}
      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, { borderColor: zone.color }]}
          onPress={handleRestart}
        >
          <Text style={[styles.btnText, { color: zone.color }]}>TRY AGAIN</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={handleShare}>
          <Text style={styles.btnTextSecondary}>SHARE</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

function Stat({ label, value, accent }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent ? { color: accent } : {}]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#050810',
    alignItems: 'center',
    paddingTop: 52, paddingBottom: 20, paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center', marginBottom: 12,
  },
  heartImg: {
    width: 64, height: 64, marginBottom: 8,
  },
  causeLabel: {
    fontSize: 34, fontWeight: '100', letterSpacing: 8, marginBottom: 4,
  },
  causeSubtitle: {
    color: '#333', fontSize: 11, letterSpacing: 2,
  },
  svgContainer: {
    width: '100%', height: 120,
    borderWidth: 1, borderColor: '#111',
    marginBottom: 14, borderRadius: 4, overflow: 'hidden',
  },
  gradeRow: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%', marginBottom: 14, paddingHorizontal: 8,
  },
  gradeLetter: {
    fontSize: 72, fontWeight: '100', lineHeight: 80,
    marginRight: 20,
  },
  gradeInfo: { justifyContent: 'center' },
  scoreDisplay: {
    fontSize: 28, fontWeight: '200', letterSpacing: 1,
  },
  bestLabel: { fontSize: 10, letterSpacing: 3, marginTop: 4 },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    width: '100%', marginBottom: 20,
  },
  stat:       { alignItems: 'center' },
  statValue:  { color: '#fff', fontSize: 18, fontWeight: '300', letterSpacing: 1 },
  statLabel:  { color: '#444', fontSize: 10, letterSpacing: 3, marginTop: 4 },
  streakRow: {
    flexDirection: 'row', gap: 20, alignItems: 'center',
    marginBottom: 14,
  },
  streakText: {
    color: '#888', fontSize: 11, letterSpacing: 4,
  },
  streakBest: {
    color: '#333', fontSize: 10, letterSpacing: 4,
  },
  newBestPrompt: {
    color: '#FFD700', fontSize: 9, letterSpacing: 4,
    marginBottom: 8, alignSelf: 'flex-start',
  },
  submitRow: {
    flexDirection: 'row', width: '100%', gap: 8,
  },
  nameInputWrap: {
    flex: 1, height: 44,
    borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 2,
    overflow: 'hidden',
  },
  nameInputField: {
    flex: 1, height: '100%',
    paddingHorizontal: 12,
    color: '#fff', fontSize: 12, letterSpacing: 3, fontWeight: '300',
    backgroundColor: '#080c14',
  },
  submitBtn: {
    height: 44, paddingHorizontal: 16,
    borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 2,
    justifyContent: 'center', alignItems: 'center',
  },
  submitBtnText: {
    color: '#555', fontSize: 11, letterSpacing: 3,
  },
  submittedText: {
    color: '#69FF47', fontSize: 10, letterSpacing: 3,
    marginBottom: 12, alignSelf: 'flex-start',
  },
  btnRow: {
    flexDirection: 'row', gap: 12, width: '100%',
  },
  btn: {
    flex: 1, paddingVertical: 14, borderRadius: 2, alignItems: 'center',
  },
  btnPrimary:       { borderWidth: 1 },
  btnSecondary:     { borderWidth: 1, borderColor: '#222' },
  btnText:          { fontSize: 12, letterSpacing: 4, fontWeight: '300' },
  btnTextSecondary: { color: '#888', fontSize: 12, letterSpacing: 4, fontWeight: '300' },
});
