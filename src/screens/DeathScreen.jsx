import React, { useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Image,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { captureRef } from '../utils/capture';
import { useGameStore } from '../store/gameStore';
import { generateEcgSvg } from '../utils/ecgRenderer';

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

  const {
    ecgHistory, score, bestScore, zone, peakBpm,
    survivalMs, bestCombo, deathCause, ringsDodged, resetGame,
  } = useGameStore();

  const isFlatline = deathCause === 'flatline';
  const isArrest   = deathCause === 'arrest';
  const causeColor = isFlatline ? '#4FC3F7' : '#FF1744';
  const causeLabel = isFlatline ? 'FLATLINE' : isArrest ? 'CARDIAC ARREST' : 'STROKE';
  const causeDesc  = isFlatline ? 'your heart stopped'
                   : isArrest   ? 'your heart gave out'
                   : 'you pushed too hard';

  const grade      = calcGrade(survivalMs, bestCombo);
  const gradeColor = GRADE_COLOR[grade];

  const svgString = useMemo(() => generateEcgSvg({
    ecgHistory, score, deathCause,
    zoneName: zone.label,
    peakBpm, lowestBpm: 0, survivalMs,
  }), [ecgHistory, score, deathCause, zone, peakBpm, survivalMs]);

  const survivalSec   = Math.floor(survivalMs / 1000);
  const minutes       = Math.floor(survivalSec / 60);
  const seconds       = survivalSec % 60;
  const survivalLabel = `${minutes}:${String(seconds).padStart(2, '0')}`;
  const scoreLabel    = Math.floor(score).toLocaleString();

  const handleShare = async () => {
    // Web: draw result card to canvas and share as PNG
    if (Platform.OS === 'web') {
      try {
        const W = 390, H = 580;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        // Title
        ctx.fillStyle = '#1a1a1a';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('P U L S E', W / 2, 36);

        // Cause of death
        ctx.fillStyle = causeColor;
        ctx.font = '300 16px monospace';
        ctx.fillText(causeLabel.toUpperCase(), W / 2, 72);

        // ECG waveform
        await new Promise((res) => {
          const img = new Image();
          const blob = new Blob([svgString], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          img.onload = () => { ctx.drawImage(img, 0, 90, W, 160); URL.revokeObjectURL(url); res(); };
          img.onerror = res;
          img.src = url;
        });

        // Grade
        ctx.fillStyle = gradeColor;
        ctx.font = '100 88px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(grade, 28, 340);

        // Score
        ctx.fillStyle = gradeColor;
        ctx.font = '300 38px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(scoreLabel, W - 28, 316);

        // Stats
        ctx.fillStyle = '#444';
        ctx.font = '300 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${survivalLabel}  ·  ×${bestCombo} COMBO  ·  ${ringsDodged} DODGED`, W / 2, 390);

        // Divider
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(28, 410); ctx.lineTo(W - 28, 410); ctx.stroke();

        // Zone
        ctx.fillStyle = zone.color;
        ctx.font = '300 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(zone.label.toUpperCase(), W / 2, 440);

        // URL
        ctx.fillStyle = '#1a1a1a';
        ctx.font = '300 10px monospace';
        ctx.fillText(window.location.hostname, W / 2, 550);

        // Share or download
        canvas.toBlob(async (blob) => {
          const file = new File([blob], 'pulse_run.png', { type: 'image/png' });
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Pulse' });
          } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'pulse_run.png';
            a.click();
          }
        }, 'image/png');
      } catch (e) {
        console.error('Web share error', e);
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
    <ScrollView
      ref={screenRef}
      contentContainerStyle={styles.container}
      bounces={false}
      collapsable={false}
    >

      {/* Heart image */}
      <Image
        source={require('../../Assets/Heart.png')}
        style={[styles.heartImg, { tintColor: causeColor }]}
        resizeMode="contain"
      />

      {/* Cause of death */}
      <Text style={[styles.causeLabel, { color: causeColor }]}>
        {causeLabel}
      </Text>
      <Text style={styles.causeSubtitle}>{causeDesc}</Text>

      {/* Zone */}
      <Text style={[styles.zoneBadge, { color: zone.color }]}>
        {zone.label.toUpperCase()}
      </Text>

      {/* ECG waveform */}
      <View style={styles.svgContainer}>
        <SvgXml xml={svgString} width="100%" height={200} />
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

      {/* Actions */}
      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary, { borderColor: zone.color }]}
        onPress={handleRestart}
      >
        <Text style={[styles.btnText, { color: zone.color }]}>TRY AGAIN</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={handleShare}>
        <Text style={styles.btnTextSecondary}>SHARE RUN</Text>
      </TouchableOpacity>

    </ScrollView>
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
    flexGrow: 1, backgroundColor: '#000',
    alignItems: 'center',
    paddingTop: 80, paddingBottom: 60, paddingHorizontal: 20,
  },
  causeLabel: {
    fontSize: 42, fontWeight: '100', letterSpacing: 10, marginBottom: 6,
  },
  causeSubtitle: {
    color: '#333', fontSize: 12, letterSpacing: 3, marginBottom: 16,
  },
  zoneBadge: {
    fontSize: 11, letterSpacing: 4, marginBottom: 32,
  },
  svgContainer: {
    width: '100%', height: 200,
    borderWidth: 1, borderColor: '#111',
    marginBottom: 32, borderRadius: 4, overflow: 'hidden',
  },
  gradeRow: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%', marginBottom: 36, paddingHorizontal: 8,
  },
  gradeLetter: {
    fontSize: 80, fontWeight: '100', lineHeight: 88,
    marginRight: 24,
  },
  gradeInfo: { justifyContent: 'center' },
  scoreDisplay: {
    fontSize: 32, fontWeight: '200', letterSpacing: 1,
  },
  bestLabel: { fontSize: 10, letterSpacing: 3, marginTop: 4 },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    width: '100%', marginBottom: 48,
  },
  stat:       { alignItems: 'center' },
  statValue:  { color: '#fff', fontSize: 22, fontWeight: '300', letterSpacing: 1 },
  statLabel:  { color: '#444', fontSize: 10, letterSpacing: 3, marginTop: 4 },
  btn: {
    width: '80%', paddingVertical: 16, borderRadius: 2,
    alignItems: 'center', marginBottom: 16,
  },
  btnPrimary:       { borderWidth: 1 },
  btnSecondary:     { borderWidth: 1, borderColor: '#222' },
  btnText:          { fontSize: 14, letterSpacing: 4, fontWeight: '300' },
  btnTextSecondary: { color: '#444', fontSize: 14, letterSpacing: 4, fontWeight: '300' },
  heartImg: {
    width: 52, height: 52, opacity: 0.5, marginBottom: 20,
  },
});
