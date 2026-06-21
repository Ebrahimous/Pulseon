import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

function Rule({ title, body }) {
  return (
    <View style={styles.rule}>
      <Text style={styles.ruleTitle}>{title}</Text>
      <Text style={styles.ruleBody}>{body}</Text>
    </View>
  );
}

export default function HowToPlayScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← BACK</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.heading}>HOW TO PLAY</Text>

        <Rule
          title="CONTROL YOUR HEART"
          body={"Tap the screen to raise your BPM. Stop tapping and it falls. Keep it between 65–85 BPM to stay in the safe zone."}
        />
        <Rule
          title="STROKE"
          body={"Your BPM climbs too high and stays there — your heart gives out. Slow down."}
        />
        <Rule
          title="FLATLINE"
          body={"Your BPM drops too low for too long — your heart stops. Keep tapping."}
        />
        <Rule
          title="RINGS"
          body={"Rings expand from the edges. Don't let them reach your dot. Each hit costs a life. Three hits and it's over."}
        />
        <Rule
          title="SCORE"
          body={"You score points every second you survive. Chain dodges to build a combo and multiply your score."}
        />
        <Rule
          title="GRADES"
          body={"S — Legendary\nA — Excellent\nB — Solid\nC — Survivor\nD — Flatlined"}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#000',
  },
  backBtn: {
    position: 'absolute', top: 52, left: 24, zIndex: 10,
    paddingVertical: 6, paddingHorizontal: 4,
  },
  backText: {
    color: '#444', fontSize: 11, letterSpacing: 3,
  },
  content: {
    paddingTop: 110, paddingHorizontal: 32, paddingBottom: 60,
  },
  heading: {
    color: '#333', fontSize: 10, letterSpacing: 5,
    marginBottom: 40,
  },
  rule: {
    marginBottom: 32,
  },
  ruleTitle: {
    color: '#69FF47', fontSize: 11, letterSpacing: 4,
    marginBottom: 8, fontWeight: '300',
  },
  ruleBody: {
    color: '#777', fontSize: 14, lineHeight: 22, fontWeight: '300',
  },
});
