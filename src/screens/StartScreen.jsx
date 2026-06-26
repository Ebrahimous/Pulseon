/**
 * StartScreen — rhythm gate
 *
 * Player must tap anywhere at 65–85 BPM continuously for 3 seconds
 * before the game starts. BPM is shown live, color-coded.
 *
 * Flow:
 *   idle      — instructions, "TAP TO BEGIN"
 *   tapping   — live BPM, in-range progress bar
 *   locked    — flash, navigate to game
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableWithoutFeedback, TouchableOpacity, StyleSheet, Animated, Image,
} from 'react-native';
import { fetchTopScores } from '../utils/leaderboard';
import * as Haptics from '../utils/haptics';
import { loadHeartbeat, playHeartbeat } from '../utils/sound';
import { useGameStore, PHASE, BPM_NORMAL_LOW, BPM_NORMAL_HIGH } from '../store/gameStore';

const IN_RANGE_REQUIRED_MS = 3000;
const TAP_WINDOW = 6;
const GRADE_COLOR = { S: '#FFD700', A: '#69FF47', B: '#4FC3F7', C: '#fff', D: '#555' };

export default function StartScreen({ navigation }) {
  const { setPhase, resetGame } = useGameStore();

  // Preload heartbeat sound
  useEffect(() => { loadHeartbeat(); }, []);

  const [uiState, setUiState]   = useState('idle');   // idle | tapping | locked
  const [liveBpm, setLiveBpm]   = useState(null);
  const [inRangeMs, setInRangeMs] = useState(0);       // progress toward 3s

  // Leaderboard
  const [topScores, setTopScores] = useState([]);
  useEffect(() => {
    fetchTopScores(5).then(setTopScores).catch(() => {});
  }, []);

  const tapTimestamps = useRef([]);
  const lastTapRef    = useRef(0);
  const inRangeRef    = useRef(0);    // ms accumulated in range
  const lastTickRef   = useRef(0);    // for delta calculation
  const frameRef      = useRef(null);

  const pulseAnim    = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // TAP metronome at ~75 BPM to show target rhythm
  const tapPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(tapPulse, { toValue: 1.4, duration: 90,  useNativeDriver: true }),
      Animated.timing(tapPulse, { toValue: 1.0, duration: 710, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  const flashPulse = () => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.2,  duration: 60,  useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 180, useNativeDriver: true }),
    ]).start();
  };

  // rAF loop: accumulates in-range time between taps (reset if too slow)
  const startProgressLoop = useCallback(() => {
    lastTickRef.current = Date.now();

    const tick = () => {
      const now   = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;

      const msSinceTap = now - lastTapRef.current;

      // If gap since last tap > one expected beat at BPM_NORMAL_LOW, reset progress
      const maxGap = (60_000 / BPM_NORMAL_LOW) * 1.3; // 20% tolerance
      if (msSinceTap > maxGap && inRangeRef.current > 0) {
        inRangeRef.current = 0;
        setInRangeMs(0);
        setLiveBpm(null);
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
  }, []);

  const stopProgressLoop = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  const handleTap = useCallback((e) => {
    const now = Date.now();
    playHeartbeat();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    flashPulse();

    if (uiState === 'locked') return;

    lastTapRef.current = now;

    // Add tap to window
    const taps = [...tapTimestamps.current, now].slice(-TAP_WINDOW);
    tapTimestamps.current = taps;

    // Calculate BPM
    let bpm = null;
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      bpm = Math.min(200, Math.max(20, Math.round(60_000 / avg)));
    }

    setLiveBpm(bpm);

    if (uiState === 'idle') {
      setUiState('tapping');
      inRangeRef.current = 0;
      startProgressLoop();
    }

    if (bpm === null) return;

    const inRange = bpm >= BPM_NORMAL_LOW && bpm <= BPM_NORMAL_HIGH;

    if (inRange) {
      // Accumulate progress
      const gap = taps.length >= 2 ? taps[taps.length - 1] - taps[taps.length - 2] : 0;
      inRangeRef.current = Math.min(IN_RANGE_REQUIRED_MS, inRangeRef.current + gap);
      setInRangeMs(inRangeRef.current);

      if (inRangeRef.current >= IN_RANGE_REQUIRED_MS) {
        // Locked — launch game
        stopProgressLoop();
        setUiState('locked');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => {
          resetGame();
          // Pre-seed the store BPM with what they just tapped
          useGameStore.setState({ displayBpm: bpm });
          setPhase(PHASE.PLAYING);
          navigation.replace('Game');
        }, 500);
      }
    } else {
      // Out of range — reset progress
      inRangeRef.current = 0;
      setInRangeMs(0);
    }
  }, [uiState, startProgressLoop, stopProgressLoop, resetGame, setPhase, navigation]);

  const bpm = liveBpm;
  const inRange = bpm !== null && bpm >= BPM_NORMAL_LOW && bpm <= BPM_NORMAL_HIGH;
  const tooFast = bpm !== null && bpm > BPM_NORMAL_HIGH;
  const tooSlow = bpm !== null && bpm < BPM_NORMAL_LOW;

  const bpmColor = tooFast ? '#FF1744' : tooSlow ? '#4FC3F7' : inRange ? '#69FF47' : '#444';
  const progressPercent = Math.min(1, inRangeMs / IN_RANGE_REQUIRED_MS);
  const isLocked = uiState === 'locked';

  const handleSkip = useCallback(() => {
    stopProgressLoop();
    resetGame();
    useGameStore.setState({ displayBpm: 75 });
    setPhase(PHASE.PLAYING);
    navigation.replace('Game');
  }, [stopProgressLoop, resetGame, setPhase, navigation]);

  return (
    <TouchableWithoutFeedback onPress={handleTap}>
      <View style={styles.container}>

        {/* How to play — top left (idle only) */}
        {uiState === 'idle' && (
          <TouchableOpacity style={styles.howToPlayBtn} onPress={() => navigation.navigate('HowToPlay')}>
            <Text style={styles.howToPlayText}>HOW TO PLAY</Text>
          </TouchableOpacity>
        )}

        {/* Back arrow — top left (while tapping, cancels back to idle) */}
        {uiState !== 'idle' && (
          <TouchableOpacity
            style={styles.howToPlayBtn}
            onPress={() => {
              stopProgressLoop();
              tapTimestamps.current = [];
              inRangeRef.current = 0;
              setUiState('idle');
              setLiveBpm(null);
              setInRangeMs(0);
            }}
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
        )}

        {/* Skip button — top right */}
        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
          <Text style={styles.skipText}>SKIP</Text>
        </TouchableOpacity>

        {/* Taglines — only in idle */}
        {uiState === 'idle' && (
          <View style={styles.taglineBlock}>
            <Text style={styles.tagline}>
              {'YOUR HEART.\n'}
              <Text style={styles.tagEmphasis}>YOUR TEMPO.</Text>
            </Text>
            <Text style={styles.tagline}>
              {'DODGE every '}
              <Text style={styles.tagEmphasis}>RING.</Text>
              {'\n'}
              <Text style={styles.tagSmall}>tap to set your rhythm</Text>
            </Text>
          </View>
        )}

        {/* Pulsating TAP indicator — only shown once tapping starts */}
        {uiState !== 'idle' && !isLocked && (
          <Animated.Text
            style={[styles.tapWord, { transform: [{ scale: tapPulse }] }]}
          >
            TAP
          </Animated.Text>
        )}

        {/* Pulsing circle with BPM centred inside — hidden until tapping */}
        <Animated.View
          style={[
            styles.circleWrap,
            { transform: [{ scale: pulseAnim }], opacity: uiState === 'idle' ? 0 : 1 },
          ]}
        >
          <View style={[
            styles.circle,
            inRange && styles.circleInRange,
            tooFast && styles.circleFast,
            tooSlow && styles.circleSlow,
            isLocked && styles.circleLocked,
          ]} />
          {bpm !== null && (
            <Text style={[styles.bpmText, { color: bpmColor }]}>{bpm}</Text>
          )}
        </Animated.View>

        {/* Status — hidden in idle (taglines already explain it) */}
        {uiState !== 'idle' && (
          <Text style={[styles.status, { color: bpmColor }]}>
            {isLocked ? 'LOCKED' : tooFast ? 'TOO FAST' : tooSlow ? 'TOO SLOW' : 'IN RANGE'}
          </Text>
        )}

        {uiState !== 'idle' && (
          <Text style={styles.sub}>
            {isLocked ? '' : inRange ? 'lock it in...' : 'find your beat'}
          </Text>
        )}

        {/* Leaderboard — idle only, top 5 */}
        {uiState === 'idle' && topScores.length > 0 && (
          <View style={styles.lbContainer}>
            <Text style={styles.lbTitle}>TOP SCORES</Text>
            {topScores.map((entry, i) => (
              <View key={entry.id} style={styles.lbRow}>
                <Text style={styles.lbRank}>{i + 1}</Text>
                <Text style={styles.lbName} numberOfLines={1}>{entry.name}</Text>
                <Text style={[styles.lbGrade, { color: GRADE_COLOR[entry.grade] || '#555' }]}>
                  {entry.grade}
                </Text>
                <Text style={styles.lbScore}>{Math.floor(entry.score).toLocaleString()}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Heart image — idle only */}
        {uiState === 'idle' && (
          <Image
            source={require('../../Assets/Heart.png')}
            style={styles.heartImg}
            resizeMode="contain"
          />
        )}

        {/* Progress bar */}
        {uiState === 'tapping' && (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${progressPercent * 100}%`, backgroundColor: bpmColor },
              ]}
            />
          </View>
        )}

        {/* Range labels */}
        {uiState === 'tapping' && (
          <Text style={styles.rangeHint}>{BPM_NORMAL_LOW} — {BPM_NORMAL_HIGH} BPM</Text>
        )}

        {/* Leaderboard button — idle only, bottom center */}
        {uiState === 'idle' && (
          <TouchableOpacity
            style={styles.lbBtn}
            onPress={() => navigation.navigate('Leaderboard')}
            activeOpacity={0.6}
          >
            <Text style={styles.lbBtnText}>LEADERBOARD</Text>
          </TouchableOpacity>
        )}

      </View>
    </TouchableWithoutFeedback>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#050810',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },
  taglineBlock: {
    position: 'absolute', top: '22%', left: 28, right: 28,
    gap: 28, alignItems: 'center',
  },
  tagline: {
    color: '#fff', fontSize: 28, fontWeight: '200',
    lineHeight: 40, letterSpacing: 1, textAlign: 'center',
  },
  tagEmphasis: {
    color: '#69FF47', fontWeight: '400',
  },
  tagDim: {
    color: '#444',
  },
  tagSmall: {
    color: '#555', fontSize: 14, fontWeight: '300',
  },
  howToPlayBtn: {
    position: 'absolute', top: 52, left: 24,
    paddingVertical: 6, paddingHorizontal: 4,
  },
  howToPlayText: {
    color: '#2a2a2a', fontSize: 11, letterSpacing: 4,
  },
  backArrow: {
    color: '#2a2a2a', fontSize: 20,
  },
  tapWord: {
    color: '#AAAAAA', fontSize: 13, letterSpacing: 10,
    paddingLeft: 10,   // compensate trailing letter-spacing so text is optically centred
    marginBottom: 20, fontWeight: '300',
  },
  circleWrap: {
    width: 120, height: 120,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 32,
  },
  circle: {
    position: 'absolute',
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 2, borderColor: '#555',
  },
  circleInRange: { borderColor: '#69FF47' },
  circleFast:    { borderColor: '#FF1744' },
  circleSlow:    { borderColor: '#4FC3F7' },
  circleLocked:  { borderColor: '#69FF47' },
  bpmText: {
    fontSize: 36, fontWeight: '200', letterSpacing: 1,
  },
  status: {
    fontSize: 16, fontWeight: '300', letterSpacing: 6, marginBottom: 8,
  },
  sub: {
    color: '#888', fontSize: 12, letterSpacing: 1, marginBottom: 32,
  },
  progressTrack: {
    width: '70%', height: 2, backgroundColor: '#1a1a1a',
    borderRadius: 1, overflow: 'hidden', marginTop: 8,
  },
  progressFill: {
    height: '100%', borderRadius: 1,
  },
  rangeHint: {
    color: '#777', fontSize: 11, letterSpacing: 3, marginTop: 12,
  },
  heartImg: {
    position: 'absolute',
    alignSelf: 'center',
    top: '60%',
    width: 200, height: 200, opacity: 0.94,
    tintColor: '#E53935',
  },
  skipBtn: {
    position: 'absolute', top: 52, right: 24,
    paddingVertical: 6, paddingHorizontal: 12,
  },
  skipText: {
    color: '#2a2a2a', fontSize: 11, letterSpacing: 4,
  },
  lbContainer: {
    position: 'absolute',
    top: '43%',
    left: 28, right: 28,
  },
  lbTitle: {
    color: '#1e1e1e', fontSize: 9, letterSpacing: 4,
    marginBottom: 10,
  },
  lbRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 7,
  },
  lbRank: {
    color: '#252525', fontSize: 10, letterSpacing: 1,
    width: 18,
  },
  lbName: {
    color: '#3a3a3a', fontSize: 11, letterSpacing: 2,
    flex: 1,
  },
  lbGrade: {
    fontSize: 10, letterSpacing: 1,
    width: 22, textAlign: 'center', opacity: 0.6,
  },
  lbScore: {
    color: '#2e2e2e', fontSize: 11, letterSpacing: 1,
    width: 72, textAlign: 'right',
  },
  lbBtn: {
    position: 'absolute', bottom: 40,
    left: 24, right: 24,
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 2,
  },
  lbBtnText: {
    color: '#666', fontSize: 10, letterSpacing: 5,
  },
});
