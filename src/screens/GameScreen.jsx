import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, Text, Image, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, {
  Circle, Polyline, Rect, Line,
  Defs, RadialGradient, Stop, Pattern,
} from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from '../utils/haptics';
import { playHeartbeat } from '../utils/sound';
import {
  useGameStore, PHASE,
} from '../store/gameStore';
import { createBpmEngine } from '../engine/bpmEngine';
import { checkAllRings } from '../engine/collision';
import { savePersisted } from '../utils/storage';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine   = Animated.createAnimatedComponent(Line);

const FRAME_MS            = 16;
const FLATLINE_WARN_MS    = 1800;
const RIPPLE_LIFETIME     = 500;
const FLOAT_LIFETIME      = 800;
const MIN_SHAKE_COMBO     = 5;
const HIT_INVINCIBILITY_MS = 1000;
const NEAR_MISS_COOLDOWN_MS = 600; // throttle adrenaline spikes

// ── BPM Graph constants ──────────────────────────────────────────────────────
const GRAPH_H       = 72;
const GRAPH_PAD_V   = 8;
const GRAPH_BPM_MIN = 40;
const GRAPH_BPM_MAX = 120;
const LABEL_W       = 44;

// Ring type colours
const RING_COLOR = {
  normal: null,   // uses accentColor
  fast:   '#FF6B6B',
  inward: '#FFB347',
};

// ── Scanlines ────────────────────────────────────────────────────────────────
function Scanlines({ width, height }) {
  return (
    <Svg
      width={width} height={height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Defs>
        <Pattern id="sl" x="0" y="0" width={width} height={5} patternUnits="userSpaceOnUse">
          <Rect x={0} y={0} width={width} height={1} fill="#FFFFFF" fillOpacity={0.025} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#sl)" />
    </Svg>
  );
}

export default function GameScreen({ navigation }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [containerDims, setContainerDims] = useState({ width: 0, height: 0 });
  const width  = containerDims.width  || winW;
  const height = containerDims.height || winH;

  const {
    phase, displayBpm, rings, playerX, playerY, accentColor, zone,
    ecgHistory, strokeAccumMs, flatlineAccumMs,
    currentBpmLow, currentBpmHigh, spawnCount,
    score, bestScore, combo, bestCombo, deathCause,
    registerTap, tickRings, tickSurvival, tickFlatline, tickStroke,
    tickDifficulty, tickBpmDecay, startGame, setPlayerPosition,
  } = useGameStore();

  // Dedicated selectors for values that need guaranteed re-render
  const lives = useGameStore(s => s.lives);

  // ── Ripples ──────────────────────────────────────────────────────────────
  const [ripples, setRipples] = useState([]);
  const rippleIdRef = useRef(0);

  // ── Floating +N texts ────────────────────────────────────────────────────
  const [floats, setFloats] = useState([]);
  const floatIdRef  = useRef(0);
  const prevComboRef = useRef(1);

  // ── Breathing glow ───────────────────────────────────────────────────────
  const breathOpacity = useRef(new Animated.Value(0.08)).current;
  const breathLoopRef = useRef(null);

  // ── Dot pulse on ring spawn ──────────────────────────────────────────────
  const dotPulse = useRef(new Animated.Value(5)).current;

  // ── Score pop on increment ────────────────────────────────────────────────
  const scorePopAnim = useRef(new Animated.Value(1)).current;
  const prevScoreRef = useRef(0);

  // ── Zone announcement ────────────────────────────────────────────────────
  const zoneAnnounceOpacity = useRef(new Animated.Value(0)).current;
  const [zoneAnnounceLabel, setZoneAnnounceLabel] = useState('');
  const [zoneAnnounceColor, setZoneAnnounceColor] = useState('#fff');
  const prevZoneIdRef = useRef(zone.id);

  // ── Combo shake ──────────────────────────────────────────────────────────
  const comboShake   = useRef(new Animated.Value(0)).current;
  const shakeLoopRef = useRef(null);

  // ── Hit invincibility ────────────────────────────────────────────────────
  const lastHitTimeRef      = useRef(0);
  const lastNearMissTimeRef = useRef(0);

  // ── Damage flash + heart animations ─────────────────────────────────────
  const damageFlash  = useRef(new Animated.Value(0)).current;
  const prevLivesRef = useRef(3);
  // One Animated.Value per heart slot (scale)
  const heartScales  = useRef([
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
  ]).current;

  // ── Dot jump on tap ──────────────────────────────────────────────────────
  const jumpAnim = useRef(new Animated.Value(0)).current;

  // ── Heart pulse on tap ───────────────────────────────────────────────────
  const heartPulse = useRef(new Animated.Value(1)).current;

  // ── Warning pulse (border flash when near death) ──────────────────────────
  const warnPulse    = useRef(new Animated.Value(0)).current;
  const warnLoopRef  = useRef(null);

  // ── Death flatline ───────────────────────────────────────────────────────
  const [showFlatline, setShowFlatline] = useState(false);
  const flatlineAnim   = useRef(new Animated.Value(0)).current;
  const deathTriggered = useRef(false);

  // ── Init player position ─────────────────────────────────────────────────
  useEffect(() => {
    setPlayerPosition(width / 2, height / 2);
  }, [width, height]);

  // ── BPM Engine ───────────────────────────────────────────────────────────
  const engineRef = useRef(null);
  useEffect(() => {
    const engine = createBpmEngine({
      getStore: useGameStore.getState,
      screenWidth: width, screenHeight: height,
    });
    engineRef.current = engine;
    engine.start();
    startGame();
    return () => engine.stop();
  }, [width, height]);

  useEffect(() => {
    engineRef.current?.updateBpm(displayBpm);
  }, [displayBpm]);

  // ── Game loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== PHASE.PLAYING) return;
    let rafId = null;
    const lastFrame = { t: Date.now() };

    const tick = () => {
      const now   = Date.now();
      const delta = Math.min(now - lastFrame.t, 100); // cap to avoid spiral after tab-switch
      lastFrame.t = now;

      tickRings(delta);
      tickSurvival(delta);
      tickFlatline(delta);
      tickStroke(delta);
      tickDifficulty(delta);
      tickBpmDecay(delta);

      // Clean expired ripples + floats
      setRipples(r => r.length ? r.filter(rp => now - rp.t < RIPPLE_LIFETIME) : r);
      setFloats(f  => f.length ? f.filter(fl => now - fl.t < FLOAT_LIFETIME)  : f);

      // Collision
      const { playerX: px, playerY: py, rings: cur } = useGameStore.getState();
      const { hit, hitRingId, nearMissIds } = checkAllRings(cur, px, py);

      if (hit && hitRingId !== null && now - lastHitTimeRef.current > HIT_INVINCIBILITY_MS) {
        lastHitTimeRef.current = now;
        useGameStore.getState().markRingHit(hitRingId);
      } else if (!hit && nearMissIds.length > 0 && now - lastNearMissTimeRef.current > NEAR_MISS_COOLDOWN_MS) {
        lastNearMissTimeRef.current = now;
        useGameStore.getState().applyNearMissScare();
      }

      // Phase check
      const { phase: p, bestScore: bs } = useGameStore.getState();
      if ((p === PHASE.DYING || p === PHASE.DEAD) && !deathTriggered.current) {
        deathTriggered.current = true;
        engineRef.current?.stop();
        savePersisted({ bestScore: bs }).catch(() => {});
        setShowFlatline(true);
        Animated.timing(flatlineAnim, {
          toValue: width, duration: 1100, useNativeDriver: false,
        }).start();
        setTimeout(() => navigation.replace('Death'), 1600);
        return; // stop loop
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [phase]);

  // ── Dot pulse on ring spawn ──────────────────────────────────────────────
  useEffect(() => {
    if (spawnCount === 0) return;
    Animated.sequence([
      Animated.timing(dotPulse, { toValue: 9, duration: 55,  useNativeDriver: false }),
      Animated.timing(dotPulse, { toValue: 5, duration: 220, useNativeDriver: false }),
    ]).start();
  }, [spawnCount]);

  // ── Breathing glow ───────────────────────────────────────────────────────
  const inRange = displayBpm >= currentBpmLow && displayBpm <= currentBpmHigh;
  useEffect(() => {
    breathLoopRef.current?.stop();
    if (inRange) {
      breathLoopRef.current = Animated.loop(Animated.sequence([
        Animated.timing(breathOpacity, { toValue: 0.18, duration: 900, useNativeDriver: false }),
        Animated.timing(breathOpacity, { toValue: 0.05, duration: 900, useNativeDriver: false }),
      ]));
      breathLoopRef.current.start();
    } else {
      Animated.timing(breathOpacity, { toValue: 0.05, duration: 300, useNativeDriver: false }).start();
    }
    return () => breathLoopRef.current?.stop();
  }, [inRange]);

  // ── Zone announcement ────────────────────────────────────────────────────
  useEffect(() => {
    if (zone.id === prevZoneIdRef.current) return;
    prevZoneIdRef.current = zone.id;
    setZoneAnnounceLabel(zone.label.toUpperCase());
    setZoneAnnounceColor(zone.color);
    zoneAnnounceOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(zoneAnnounceOpacity, { toValue: 1,   duration: 250, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(zoneAnnounceOpacity, { toValue: 0,   duration: 500, useNativeDriver: true }),
    ]).start();
  }, [zone.id]);

  // ── Combo shake ──────────────────────────────────────────────────────────
  const isRecord = bestCombo >= MIN_SHAKE_COMBO && combo >= bestCombo;
  useEffect(() => {
    shakeLoopRef.current?.stop();
    if (isRecord) {
      shakeLoopRef.current = Animated.loop(Animated.sequence([
        Animated.timing(comboShake, { toValue:  3, duration: 45, useNativeDriver: true }),
        Animated.timing(comboShake, { toValue: -3, duration: 45, useNativeDriver: true }),
        Animated.timing(comboShake, { toValue:  0, duration: 45, useNativeDriver: true }),
      ]));
      shakeLoopRef.current.start();
    } else {
      comboShake.setValue(0);
    }
    return () => shakeLoopRef.current?.stop();
  }, [isRecord]);

  // ── Derived (needed before effects that reference them) ──────────────────
  const isBeatingBest = bestScore > 10 && score >= bestScore;

  // ── Score pop every time score increases ─────────────────────────────────
  useEffect(() => {
    if (score > prevScoreRef.current) {
      prevScoreRef.current = score;
      // Bigger pop when beating the record
      const peakScale = isBeatingBest ? 1.22 : 1.12;
      scorePopAnim.stopAnimation();
      Animated.sequence([
        Animated.timing(scorePopAnim, { toValue: peakScale, duration: 60,  useNativeDriver: true }),
        Animated.timing(scorePopAnim, { toValue: 1,         duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [score, isBeatingBest]);

  // ── Warning pulse border when near flatline or stroke ────────────────────
  const strokeWarnDerived   = strokeAccumMs   >= 1500;
  const flatlineWarnDerived = flatlineAccumMs >= FLATLINE_WARN_MS;
  const inDanger = strokeWarnDerived || flatlineWarnDerived;
  useEffect(() => {
    warnLoopRef.current?.stop();
    if (inDanger) {
      warnLoopRef.current = Animated.loop(Animated.sequence([
        Animated.timing(warnPulse, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(warnPulse, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]));
      warnLoopRef.current.start();
    } else {
      warnPulse.setValue(0);
    }
    return () => warnLoopRef.current?.stop();
  }, [inDanger]);

  // ── Damage flash + heart pop when lives decrease ─────────────────────────
  useEffect(() => {
    if (lives < prevLivesRef.current) {
      const lostIdx = lives; // e.g. lives just became 2 → heart at index 2 pops off

      // Red screen flash
      damageFlash.setValue(0.45);
      Animated.timing(damageFlash, { toValue: 0, duration: 450, useNativeDriver: true }).start();

      // Heart pop: scale up briefly then spring to 0
      if (lostIdx >= 0 && lostIdx < heartScales.length) {
        Animated.sequence([
          Animated.timing(heartScales[lostIdx], { toValue: 1.5, duration: 80,  useNativeDriver: true }),
          Animated.timing(heartScales[lostIdx], { toValue: 0,   duration: 200, useNativeDriver: true }),
        ]).start();
      }
    }
    prevLivesRef.current = lives;
  }, [lives]);

  // ── +N float on combo increase ───────────────────────────────────────────
  useEffect(() => {
    if (combo > prevComboRef.current && combo > 0) {
      const gained = combo - prevComboRef.current;
      const anim   = new Animated.Value(0);
      const id     = floatIdRef.current++;
      setFloats(f => [...f, { id, anim, gained, t: Date.now() }]);
      Animated.timing(anim, { toValue: 1, duration: FLOAT_LIFETIME, useNativeDriver: true }).start();
    }
    prevComboRef.current = combo;
  }, [combo]);

  // ── Tap gesture ──────────────────────────────────────────────────────────
  const tapGesture = Gesture.Pan()
    .runOnJS(true)
    .onBegin((e) => {
      playHeartbeat();
      registerTap(e.x, e.y);

      // Heart pulse
      heartPulse.stopAnimation();
      Animated.sequence([
        Animated.timing(heartPulse, { toValue: 1.28, duration: 80,  useNativeDriver: true }),
        Animated.timing(heartPulse, { toValue: 1.0,  duration: 320, useNativeDriver: true }),
      ]).start();

      // Dot jump
      jumpAnim.stopAnimation();
      jumpAnim.setValue(0);
      Animated.sequence([
        Animated.timing(jumpAnim, { toValue: -18, duration: 80,  useNativeDriver: true }),
        Animated.timing(jumpAnim, { toValue:   0, duration: 220, useNativeDriver: true }),
      ]).start();

      const ripId = rippleIdRef.current++;
      setRipples(r => [...r, { id: ripId, x: e.x, y: e.y, t: Date.now() }]);

      // Lub-dub haptics
      const { zone: z } = useGameStore.getState();
      const style = (z?.id === 'abyss' || z?.id === 'void')
        ? Haptics.ImpactFeedbackStyle.Heavy
        : z?.id === 'deep' ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light;
      Haptics.impactAsync(style);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 120);

    });

  // ── Derived ──────────────────────────────────────────────────────────────
  const bpmColor     = getBpmColor(displayBpm, currentBpmLow, currentBpmHigh);
  const strokeWarn   = strokeWarnDerived;
  const flatlineWarn = flatlineWarnDerived;
  const warnColor    = strokeWarn ? '#FF1744' : '#4FC3F7';

  const vignetteColor   = strokeWarn   ? '#FF1744' : flatlineWarn ? '#1A6688' : '#000000';
  const vignetteOpacity = strokeWarn
    ? 0.25 + (strokeAccumMs   / 3000) * 0.55
    : flatlineWarn
      ? 0.2  + ((flatlineAccumMs - FLATLINE_WARN_MS) / (3200 - FLATLINE_WARN_MS)) * 0.5
      : 0.25;

  const comboColor = isRecord ? '#FFA726' : accentColor;
  const comboGlow  = isRecord ? 20 : 0;
  const now        = Date.now();

  const bestScoreLabel = bestScore > 10 ? Math.floor(bestScore).toLocaleString() : null;
  const scoreGlowColor = isBeatingBest ? '#FFD700' : accentColor;
  const scoreGlowSize  = isBeatingBest ? 18 : 8;

  const flatlineColor = deathCause === 'flatline' ? '#4FC3F7' : '#FF1744';
  const flatlineLabel = deathCause === 'flatline' ? 'FLATLINE'
                      : deathCause === 'arrest'   ? 'CARDIAC ARREST'
                      : 'STROKE';

  return (
    <View
      style={styles.container}
      onLayout={e => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w > 0 && h > 0) setContainerDims({ width: w, height: h });
      }}
    >

      {/* Scanlines */}
      <Scanlines width={width} height={height} />

      {/* Pulsing heart — centred, beats with each tap */}
      <Animated.Image
        source={require('../../Assets/Heart.png')}
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: 200, height: 200,
          left: width / 2 - 100,
          top:  height / 2 - 100,
          opacity: 0.45,
          tintColor: '#6B0000',
          transform: [{ scale: heartPulse }],
        }}
        resizeMode="contain"
      />

      {/* Score — top center */}
      <Animated.View
        style={[styles.scoreArea, { transform: [{ scale: scorePopAnim }] }]}
        pointerEvents="none"
      >
        <Text
          style={[
            styles.scoreText,
            {
              color: isBeatingBest ? '#FFD700' : accentColor,
              textShadowColor: scoreGlowColor,
              textShadowRadius: scoreGlowSize,
              textShadowOffset: { width: 0, height: 0 },
            },
          ]}
        >
          {Math.floor(score).toLocaleString()}
        </Text>
        {bestScoreLabel && (
          <Text style={[styles.bestLabel, { color: isBeatingBest ? '#FFD700' : '#333' }]}>
            {isBeatingBest ? '★ NEW BEST' : `BEST ${bestScoreLabel}`}
          </Text>
        )}
      </Animated.View>

      {/* BPM graph strip */}
      <View style={styles.graphContainer} pointerEvents="none">
        <BpmGraph
          history={ecgHistory} screenWidth={width}
          bpmColor={bpmColor} rangeLow={currentBpmLow} rangeHigh={currentBpmHigh}
        />
        <View style={styles.bpmOverlay}>
          <Text style={[styles.bpmNumber, { color: bpmColor }]}>{displayBpm}</Text>
          <Text style={[styles.bpmUnit,   { color: bpmColor }]}>BPM</Text>
          <Text style={[styles.rangeLabel, { color: bpmColor }]}>
            {currentBpmLow}–{currentBpmHigh}
          </Text>
        </View>
      </View>

      {/* Lives — top left */}
      <View style={styles.livesRow} pointerEvents="none">
        {[0, 1, 2].map(i => (
          <Animated.Text
            key={i}
            style={[
              styles.heart,
              {
                color: i < lives ? '#FF1744' : '#1e1e1e',
                transform: [{ scale: heartScales[i] }],
              },
            ]}
          >
            ♥
          </Animated.Text>
        ))}
      </View>

      {/* Combo — top right, large, shakes at record */}
      {combo > 1 && (
        <Animated.Text
          style={[
            styles.comboLarge,
            {
              color: comboColor,
              textShadowColor: isRecord ? '#FF6D00' : 'transparent',
              textShadowRadius: comboGlow,
              textShadowOffset: { width: 0, height: 0 },
              transform: [{ translateX: comboShake }],
            },
          ]}
          pointerEvents="none"
        >
          ×{combo}
        </Animated.Text>
      )}

      {/* Warnings */}
      {strokeWarn && (
        <View style={styles.warnContainer} pointerEvents="none">
          <Text style={styles.strokeWarn}>STROKE RISK</Text>
        </View>
      )}
      {flatlineWarn && !strokeWarn && (
        <View style={styles.warnContainer} pointerEvents="none">
          <Text style={styles.flatlineWarn}>KEEP TAPPING</Text>
        </View>
      )}

      {/* Vignette */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="vig" cx="50%" cy="50%" rx="65%" ry="65%">
            <Stop offset="0%"   stopColor={vignetteColor} stopOpacity={0} />
            <Stop offset="100%" stopColor={vignetteColor} stopOpacity={vignetteOpacity} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#vig)" />
      </Svg>

      {/* Canvas */}
      <GestureDetector gesture={tapGesture}>
        <View style={StyleSheet.absoluteFill}>
          <Svg width={width} height={height}>

            {/* Rings */}
            {rings.map((ring) => {
              const dir      = ring.dir ?? 1;
              // For outward rings: 0=just spawned, 1=expired
              // For inward rings: 0=just spawned (full size), 1=collapsed
              const progress = dir > 0
                ? ring.radius / ring.maxRadius
                : 1 - ring.radius / ring.maxRadius;
              const baseOpacity = Math.max(0.03, 0.5 * (1 - progress * 0.85));
              const opacity  = baseOpacity * (ring.spawnOpacity ?? 1);
              const strokeW  = Math.max(0.8, 2.0 * (1 - progress * 0.7));
              const color    = RING_COLOR[ring.type] ?? accentColor;
              return (
                <Circle
                  key={ring.id}
                  cx={ring.originX} cy={ring.originY}
                  r={Math.max(0, ring.radius)}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeW}
                  strokeOpacity={opacity}
                  strokeDasharray={ring.type === 'inward' ? '10 5' : undefined}
                />
              );
            })}

            {/* Tap ripples */}
            {ripples.map((rp) => {
              const age    = (now - rp.t) / RIPPLE_LIFETIME;
              const radius = age * 52;
              const op     = (1 - age) * 0.45;
              return (
                <Circle
                  key={rp.id}
                  cx={rp.x} cy={rp.y} r={radius}
                  fill="none" stroke="#FFFFFF"
                  strokeWidth={1} strokeOpacity={op}
                />
              );
            })}

            {/* Breathing glow — rendered as SVG circle (static position, opacity animates) */}
            <AnimatedCircle
              cx={playerX} cy={playerY} r={24}
              fill={bpmColor} fillOpacity={breathOpacity}
            />

          </Svg>
        </View>
      </GestureDetector>

      {/* Player dot — outside SVG so jump uses useNativeDriver */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: playerX - 5,
          top:  playerY - 5,
          width: 10, height: 10,
          transform: [{ translateY: jumpAnim }],
        }}
      >
        <Animated.View style={{
          width: dotPulse.interpolate({ inputRange: [5, 9], outputRange: [10, 18] }),
          height: dotPulse.interpolate({ inputRange: [5, 9], outputRange: [10, 18] }),
          borderRadius: 9,
          backgroundColor: '#FFFFFF',
          marginLeft: dotPulse.interpolate({ inputRange: [5, 9], outputRange: [0, -4] }),
          marginTop:  dotPulse.interpolate({ inputRange: [5, 9], outputRange: [0, -4] }),
        }} />
      </Animated.View>

      {/* Warning border — pulses when near stroke or flatline */}
      {inDanger && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderWidth: 3, borderColor: warnColor, opacity: warnPulse },
          ]}
        />
      )}

      {/* Zone label — persistent, bottom center */}
      <Text style={[styles.zoneLabel, { color: zone.color }]} pointerEvents="none">
        {zone.label.toUpperCase()}
      </Text>

      {/* Zone announcement */}
      <Animated.Text
        style={[styles.zoneAnnounce, { color: zoneAnnounceColor, opacity: zoneAnnounceOpacity }]}
        pointerEvents="none"
      >
        {zoneAnnounceLabel}
      </Animated.Text>

      {/* +N floats */}
      {floats.map((fl) => {
        const translateY = fl.anim.interpolate({ inputRange: [0, 1], outputRange: [0, -60] });
        const opacity    = fl.anim.interpolate({ inputRange: [0, 0.25, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.Text
            key={fl.id}
            style={[styles.floatText, { color: comboColor, opacity, transform: [{ translateY }] }]}
            pointerEvents="none"
          >
            +{fl.gained}
          </Animated.Text>
        );
      })}

      {/* Damage flash */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: '#FF1744', opacity: damageFlash }]}
        pointerEvents="none"
      />

      {/* Death transition overlay */}
      {showFlatline && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: 0.82 }]} />
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <AnimatedLine
              x1={0} y1={height / 2}
              x2={flatlineAnim} y2={height / 2}
              stroke={flatlineColor} strokeWidth={1.5}
            />
          </Svg>
          <Text style={[styles.flatlineLabel, { color: flatlineColor }]}>
            {flatlineLabel}
          </Text>
        </View>
      )}

    </View>
  );
}

// ── BPM Graph ─────────────────────────────────────────────────────────────────
function bpmToY(bpm) {
  const norm = (bpm - GRAPH_BPM_MIN) / (GRAPH_BPM_MAX - GRAPH_BPM_MIN);
  return GRAPH_H - GRAPH_PAD_V - norm * (GRAPH_H - GRAPH_PAD_V * 2);
}

function BpmGraph({ history, screenWidth, bpmColor, rangeLow, rangeHigh }) {
  const w          = screenWidth - LABEL_W;
  const safeTop    = bpmToY(rangeHigh);
  const safeBottom = bpmToY(rangeLow);
  const samples    = history.slice(-50).filter((s) => Number.isFinite(s.bpm));
  const n          = samples.length;
  const points     = n >= 2
    ? samples.map((s, i) => `${(i / (n - 1)) * w},${bpmToY(s.bpm)}`).join(' ')
    : null;

  return (
    <Svg width={screenWidth} height={GRAPH_H}>
      <Rect x={0} y={safeTop} width={w} height={safeBottom - safeTop}
        fill="#69FF47" fillOpacity={0.07} />
      <Line x1={0} y1={safeTop}    x2={w} y2={safeTop}
        stroke="#69FF47" strokeWidth={0.5} strokeOpacity={0.35} />
      <Line x1={0} y1={safeBottom} x2={w} y2={safeBottom}
        stroke="#69FF47" strokeWidth={0.5} strokeOpacity={0.35} />
      {points && (
        <Polyline points={points} fill="none"
          stroke={bpmColor} strokeWidth={1.5} strokeOpacity={0.9}
          strokeLinecap="round" strokeLinejoin="round" />
      )}
    </Svg>
  );
}

function getBpmColor(bpm, low, high) {
  if (bpm < low)  return '#4FC3F7';
  if (bpm > high) return '#FF1744';
  return '#69FF47';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  scoreArea: {
    position: 'absolute', top: 36, alignSelf: 'center',
    alignItems: 'center', zIndex: 30,
  },
  scoreText: { fontSize: 56, fontWeight: '300', letterSpacing: 2 },
  bestLabel: { fontSize: 10, letterSpacing: 4, marginTop: 2 },

  graphContainer: {
    position: 'absolute', top: 106, left: 0, right: 0,
    height: GRAPH_H, zIndex: 10,
  },
  bpmOverlay: {
    position: 'absolute', right: 0, top: 0,
    width: LABEL_W, height: GRAPH_H,
    alignItems: 'center', justifyContent: 'center',
  },
  bpmNumber:  { fontSize: 18, fontWeight: '300', lineHeight: 20 },
  bpmUnit:    { fontSize: 8,  letterSpacing: 2, opacity: 0.6 },
  rangeLabel: { fontSize: 7,  letterSpacing: 1, opacity: 0.5, marginTop: 2 },

  livesRow: {
    position: 'absolute', top: 10, left: 16,
    flexDirection: 'row', gap: 6, zIndex: 30,
  },
  heart: { fontSize: 18 },

  comboLarge: {
    position: 'absolute', top: 120, right: 20,
    fontSize: 60, fontWeight: '100', letterSpacing: 2,
    zIndex: 15,
  },

  warnContainer: {
    position: 'absolute', top: '46%', width: '100%',
    alignItems: 'center', zIndex: 10,
  },
  strokeWarn:   { color: '#FF1744', fontSize: 13, letterSpacing: 5, fontWeight: '300' },
  flatlineWarn: { color: '#4FC3F7', fontSize: 13, letterSpacing: 5, fontWeight: '300' },

  zoneLabel: {
    position: 'absolute', bottom: 28, alignSelf: 'center',
    fontSize: 9, fontWeight: '300', letterSpacing: 5,
    opacity: 0.35, zIndex: 10,
  },

  zoneAnnounce: {
    position: 'absolute', alignSelf: 'center', top: '38%',
    fontSize: 20, fontWeight: '100', letterSpacing: 12,
    zIndex: 20,
  },

  floatText: {
    position: 'absolute', top: 192, right: 20,
    fontSize: 16, fontWeight: '200', letterSpacing: 2,
    zIndex: 25,
  },

  flatlineLabel: {
    position: 'absolute', alignSelf: 'center', top: '43%',
    fontSize: 26, fontWeight: '100', letterSpacing: 10,
  },
});
