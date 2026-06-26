import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { fetchTopScores } from '../utils/leaderboard';

const GRADE_COLOR = { S: '#FFD700', A: '#69FF47', B: '#4FC3F7', C: '#fff', D: '#555' };

function formatTime(ms) {
  if (!ms) return '--';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function LeaderboardScreen({ navigation }) {
  const [scores,  setScores]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    fetchTopScores(10)
      .then(data => { setScores(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  };

  useEffect(load, []);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← BACK</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>LEADERBOARD</Text>

      {loading && (
        <ActivityIndicator color="#333" style={{ marginTop: 40 }} />
      )}

      {error && !loading && (
        <View style={styles.centerMsg}>
          <Text style={styles.errorText}>COULD NOT LOAD</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>RETRY</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && scores.length === 0 && (
        <View style={styles.centerMsg}>
          <Text style={styles.emptyText}>NO SCORES YET</Text>
          <Text style={styles.emptySubText}>be the first to post a run</Text>
        </View>
      )}

      {!loading && !error && scores.length > 0 && (
        <ScrollView
          style={styles.list}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        >
          {/* Header row */}
          <View style={styles.headerRow}>
            <Text style={[styles.colRank,  styles.colHeader]}>#</Text>
            <Text style={[styles.colName,  styles.colHeader]}>NAME</Text>
            <Text style={[styles.colGrade, styles.colHeader]}>GR</Text>
            <Text style={[styles.colTime,  styles.colHeader]}>TIME</Text>
            <Text style={[styles.colScore, styles.colHeader]}>SCORE</Text>
          </View>

          <View style={styles.divider} />

          {scores.map((entry, i) => {
            const gradeColor = GRADE_COLOR[entry.grade] || '#555';
            const isTop3 = i < 3;
            return (
              <View key={entry.id} style={[styles.row, isTop3 && styles.rowTop3]}>
                <Text style={[styles.colRank, isTop3 && styles.rankTop3]}>
                  {i + 1}
                </Text>
                <Text style={styles.colName} numberOfLines={1}>
                  {entry.name || '—'}
                </Text>
                <Text style={[styles.colGrade, { color: gradeColor, opacity: 0.8 }]}>
                  {entry.grade || '—'}
                </Text>
                <Text style={styles.colTime}>
                  {formatTime(entry.survivalMs)}
                </Text>
                <Text style={[styles.colScore, isTop3 && { color: '#888' }]}>
                  {Math.floor(entry.score).toLocaleString()}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Refresh button */}
      {!loading && (
        <TouchableOpacity style={styles.refreshBtn} onPress={load}>
          <Text style={styles.refreshText}>REFRESH</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#050810',
    paddingTop: 52, paddingBottom: 24, paddingHorizontal: 24,
  },
  backBtn: {
    position: 'absolute', top: 52, left: 24, zIndex: 10,
    paddingVertical: 6, paddingHorizontal: 4,
  },
  backText: {
    color: '#444', fontSize: 11, letterSpacing: 3,
  },
  heading: {
    color: '#1e1e1e', fontSize: 10, letterSpacing: 5,
    marginTop: 40, marginBottom: 28, textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 10,
  },
  colHeader: {
    color: '#1e1e1e', fontSize: 9, letterSpacing: 3,
  },
  divider: {
    height: 1, backgroundColor: '#0d0d0d', marginBottom: 10,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#0a0a0a',
  },
  rowTop3: {
    borderBottomColor: '#111',
  },
  colRank: {
    width: 28, color: '#252525', fontSize: 11, letterSpacing: 1,
  },
  rankTop3: {
    color: '#3a3a3a',
  },
  colName: {
    flex: 1, color: '#555', fontSize: 12, letterSpacing: 2,
    fontWeight: '300',
  },
  colGrade: {
    width: 28, textAlign: 'center', fontSize: 11, letterSpacing: 1,
  },
  colTime: {
    width: 52, textAlign: 'right',
    color: '#2e2e2e', fontSize: 11, letterSpacing: 1,
  },
  colScore: {
    width: 80, textAlign: 'right',
    color: '#444', fontSize: 13, letterSpacing: 1, fontWeight: '200',
  },
  centerMsg: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  errorText: {
    color: '#333', fontSize: 11, letterSpacing: 4,
  },
  emptyText: {
    color: '#252525', fontSize: 11, letterSpacing: 4,
  },
  emptySubText: {
    color: '#1a1a1a', fontSize: 11, letterSpacing: 2,
  },
  retryBtn: {
    paddingVertical: 10, paddingHorizontal: 24,
    borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 2,
  },
  retryText: {
    color: '#333', fontSize: 11, letterSpacing: 4,
  },
  refreshBtn: {
    alignSelf: 'center', marginTop: 16,
    paddingVertical: 10, paddingHorizontal: 24,
    borderWidth: 1, borderColor: '#111', borderRadius: 2,
  },
  refreshText: {
    color: '#222', fontSize: 10, letterSpacing: 4,
  },
});
