/**
 * SeedPhraseConfirmationScreen — Verify user saved seed phrase by asking random words.
 */

import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert } from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';

type Props = {
  navigation: StackNavigationProp<RootStackParamList, 'SeedPhraseConfirmation'>;
  route: { params: { mnemonic: string; password: string } };
};

export default function SeedPhraseConfirmationScreen({ navigation, route }: Props): React.JSX.Element {
  const { mnemonic } = route.params;
  const login = useAppStore((s) => s.login);
  const words = mnemonic.split(' ');

  // Pick 4 random words to verify
  const checkIndices = useMemo(() => {
    const indices: number[] = [];
    while (indices.length < 4) {
      const idx = Math.floor(Math.random() * words.length);
      if (!indices.includes(idx)) indices.push(idx);
    }
    return indices.sort((a, b) => a - b);
  }, []);

  const targetWords = checkIndices.map(i => words[i]);

  // Build all word options (correct + decoys)
  const allWords = useMemo(() => {
    // Just use nearby words from the mnemonic as decoys
    const pool = [...new Set(words)];
    return checkIndices.map((targetIdx, qi) => {
      const correct = words[targetIdx];
      const decoys = pool.filter(w => w !== correct).slice(0, 2);
      const options = [correct, ...decoys].sort(() => Math.random() - 0.5);
      return { questionIdx: qi + 1, wordIndex: targetIdx + 1, options };
    });
  }, []);

  const [answers, setAnswers] = useState<Record<number, string>>({});

  const selectAnswer = (questionIdx: number, word: string) => {
    setAnswers(prev => ({ ...prev, [questionIdx]: word }));
  };

  const handleConfirm = () => {
    const allCorrect = checkIndices.every((wordIdx, qi) => answers[qi + 1] === words[wordIdx]);
    if (allCorrect) {
      Alert.alert('Success', 'Your seed phrase has been verified. Welcome to HSMC!', [
        { text: 'Continue', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] }) },
      ]);
    } else {
      Alert.alert('Incorrect', 'Some words are incorrect. Please review and try again.', [
        { text: 'Try Again', onPress: () => setAnswers({}) },
      ]);
    }
  };

  const allAnswered = checkIndices.every((_, qi) => answers[qi + 1]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Verify Seed Phrase</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.instructions}>
          Confirm you've saved your seed phrase by selecting the correct words.
        </Text>

        {allWords.map(({ questionIdx, wordIndex, options }) => (
          <View key={questionIdx} style={styles.questionBlock}>
            <Text style={styles.questionText}>
              Word #{wordIndex}
            </Text>
            <View style={styles.optionsRow}>
              {options.map((word) => {
                const selected = answers[questionIdx] === word;
                return (
                  <TouchableOpacity
                    key={word}
                    style={[styles.optionButton, selected && styles.optionSelected]}
                    onPress={() => selectAnswer(questionIdx, word)}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {word}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.confirmButton, !allAnswered && styles.buttonDisabled]}
          onPress={handleConfirm}
          disabled={!allAnswered}
        >
          <Text style={styles.confirmButtonText}>Confirm & Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  header: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E2E' },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  content: { padding: 24 },
  instructions: { color: '#888899', fontSize: 14, lineHeight: 20, marginBottom: 24, textAlign: 'center' },
  questionBlock: { marginBottom: 24 },
  questionText: { color: '#AAAAAA', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  optionsRow: { flexDirection: 'row', gap: 8 },
  optionButton: {
    flex: 1, backgroundColor: '#151520', paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 10, alignItems: 'center', borderWidth: 2, borderColor: '#2A2A35',
  },
  optionSelected: { borderColor: '#6C5CE7', backgroundColor: '#1A1540' },
  optionText: { color: '#CCCCCC', fontSize: 13, fontFamily: 'monospace' },
  optionTextSelected: { color: '#6C5CE7', fontWeight: '700' },
  confirmButton: { backgroundColor: '#6C5CE7', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  buttonDisabled: { opacity: 0.5 },
  confirmButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
