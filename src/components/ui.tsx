/**
 * Design system — Canvas-LMS-inspired neutrals with UMD accents.
 *
 * Principles (what keeps this from looking generated):
 *  - Color is information, not decoration: near-everything is ink on white;
 *    UMD red appears only on primary actions, links, and live states.
 *  - Lato everywhere (same face Canvas/ELMS uses), real icons (Ionicons),
 *    no emoji glyphs.
 *  - Flat surfaces separated by hairlines, not drop shadows or tinted panels.
 *  - Motion is quiet: 200ms fades on screen focus, slight press scale on
 *    buttons, one branded loading state.
 */

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useApp } from '../state/AppContext';

export const FONT = {
  regular: 'Lato_400Regular',
  bold: 'Lato_700Bold',
  black: 'Lato_900Black',
} as const;

export interface ThemeColors {
  text: string;
  textSecondary: string;
  background: string;
  card: string;
  border: string;
  hairline: string;
  accent: string;
  accentPressed: string;
  accentText: string;
  gold: string;
  success: string;
  warning: string;
  danger: string;
  subtle: string;
  inputBorder: string;
}

export const Palette: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    text: '#2D3B45', // Canvas "ink"
    textSecondary: '#66727C',
    background: '#F6F7F8',
    card: '#FFFFFF',
    border: '#E3E6E8',
    hairline: '#ECEEF0',
    accent: '#E21833', // UMD red
    accentPressed: '#C11228',
    accentText: '#FFFFFF',
    gold: '#FFD200',
    success: '#2D7D46',
    warning: '#9A6700',
    danger: '#B3001B',
    subtle: '#F2F4F5',
    inputBorder: '#C7CDD1',
  },
  dark: {
    text: '#E8ECEF',
    textSecondary: '#95A1AB',
    background: '#101418',
    card: '#191F24',
    border: '#2A3238',
    hairline: '#232B31',
    accent: '#FF5063',
    accentPressed: '#E93F53',
    accentText: '#14181C',
    gold: '#FFD200',
    success: '#5CB878',
    warning: '#DCA54C',
    danger: '#F2707E',
    subtle: '#222A30',
    inputBorder: '#3A444C',
  },
};

export function useColors(): ThemeColors {
  const { scheme } = useApp();
  return Palette[scheme];
}

// ---------- motion ----------

/**
 * Fades + lifts its children every time the screen gains focus, which makes
 * tab switches feel like transitions instead of hard cuts.
 */
export function ScreenFade({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const [opacity] = useState(() => new Animated.Value(0));
  const [translate] = useState(() => new Animated.Value(8));

  useFocusEffect(
    useCallback(() => {
      opacity.setValue(0);
      translate.setValue(8);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translate, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }, [opacity, translate]),
  );

  return (
    <Animated.View style={[{ flex: 1, opacity, transform: [{ translateY: translate }] }, style]}>
      {children}
    </Animated.View>
  );
}

// ---------- layout ----------

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ flex: 1, backgroundColor: c.background }, style]}>
      <ScreenFade>{children}</ScreenFade>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: 8,
          padding: 16,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          marginBottom: 12,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.hairline, marginVertical: 12 }, style]} />;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;
}

// ---------- typography ----------

export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return (
    <Text style={[{ fontSize: 21, fontFamily: FONT.bold, color: c.text, marginBottom: 6, lineHeight: 28 }, style]}>
      {children}
    </Text>
  );
}

/** Section header — normal case with a hairline underneath, like Canvas. */
export function Subtitle({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <View
      style={{
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
        paddingBottom: 6,
        marginBottom: 12,
        marginTop: 8,
      }}>
      <Text style={{ fontSize: 15, fontFamily: FONT.bold, color: c.text }}>{children}</Text>
    </View>
  );
}

export function Body({
  children,
  secondary,
  style,
}: {
  children: React.ReactNode;
  secondary?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const c = useColors();
  return (
    <Text
      style={[
        { fontSize: 15, lineHeight: 22, fontFamily: FONT.regular, color: secondary ? c.textSecondary : c.text },
        style,
      ]}>
      {children}
    </Text>
  );
}

// ---------- icons ----------

export type IconName = keyof typeof Ionicons.glyphMap;

export function Icon({
  name,
  size = 18,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const c = useColors();
  return <Ionicons name={name} size={size} color={color ?? c.textSecondary} style={style} />;
}

/** An icon + text line, the building block of Canvas-style detail rows. */
export function IconRow({
  icon,
  children,
  color,
  iconColor,
  style,
}: {
  icon: IconName;
  children: React.ReactNode;
  /** Colors both icon and text. */
  color?: string;
  /** Colors just the icon (text stays ink) — for brand accents. */
  iconColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginVertical: 3 }, style]}>
      <Icon name={icon} size={16} color={iconColor ?? color ?? c.textSecondary} style={{ marginTop: 3 }} />
      <Body style={{ flex: 1, color: color ?? undefined }}>{children}</Body>
    </View>
  );
}

// ---------- controls ----------

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  compact,
  icon,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'tonal' | 'danger' | 'ghost';
  disabled?: boolean;
  compact?: boolean;
  icon?: IconName;
}) {
  const c = useColors();
  const [scale] = useState(() => new Animated.Value(1));

  const pressIn = () =>
    Animated.timing(scale, { toValue: 0.97, duration: 80, useNativeDriver: true }).start();
  const pressOut = () =>
    Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start();

  const palette: Record<string, { bg: string; bgPressed: string; fg: string; border?: string }> = {
    primary: { bg: c.accent, bgPressed: c.accentPressed, fg: c.accentText },
    secondary: { bg: c.card, bgPressed: c.subtle, fg: c.text, border: c.inputBorder },
    // Tinted brand button (iOS-style): colorful without shouting.
    tonal: { bg: c.accent + '14', bgPressed: c.accent + '26', fg: c.accent },
    danger: { bg: c.danger, bgPressed: c.danger, fg: '#FFFFFF' },
    ghost: { bg: 'transparent', bgPressed: c.subtle, fg: c.accent },
  };
  const t = palette[kind];

  return (
    <Animated.View style={{ transform: [{ scale }], marginVertical: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled}
        style={({ pressed }) => ({
          backgroundColor: pressed ? t.bgPressed : t.bg,
          opacity: disabled ? 0.45 : 1,
          paddingVertical: compact ? 7 : 12,
          paddingHorizontal: compact ? 12 : 18,
          borderRadius: 6,
          borderWidth: t.border ? 1 : 0,
          borderColor: t.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 6,
          minHeight: compact ? 34 : 44,
        })}>
        {icon ? <Ionicons name={icon} size={compact ? 15 : 17} color={t.fg} /> : null}
        <Text style={{ color: t.fg, fontFamily: FONT.bold, fontSize: compact ? 13.5 : 15.5 }}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Small inline text button, Canvas-link style. */
export function TextLink({ label, onPress, icon }: { label: string; onPress: () => void; icon?: IconName }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1, paddingVertical: 4 })}>
      {icon ? <Ionicons name={icon} size={15} color={c.accent} /> : null}
      <Text style={{ color: c.accent, fontFamily: FONT.bold, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const c = useColors();
  const colors: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: c.subtle, fg: c.textSecondary },
    success: { bg: c.success + '1A', fg: c.success },
    warning: { bg: c.warning + '1A', fg: c.warning },
    danger: { bg: c.danger + '14', fg: c.danger },
    accent: { bg: c.accent + '14', fg: c.accent },
  };
  const t = colors[tone];
  // Normalize to sentence case so pills read like Canvas statuses
  // ("Scheduled") rather than raw enum values ("scheduled") or alarms
  // ("SCHEDULED").
  const normalized =
    label === label.toUpperCase() && /[A-Z]{3,}/.test(label) ? label.toLowerCase() : label;
  const display = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.fg, fontSize: 12, fontFamily: FONT.bold }}>{display}</Text>
    </View>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint: string; icon?: IconName }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: c.subtle,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 14,
        }}>
        <Ionicons name={icon ?? 'compass-outline'} size={28} color={c.textSecondary} />
      </View>
      <Text style={{ fontSize: 17, fontFamily: FONT.bold, color: c.text, marginBottom: 6, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ fontSize: 14, fontFamily: FONT.regular, color: c.textSecondary, textAlign: 'center', lineHeight: 21 }}>
        {hint}
      </Text>
    </View>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 12 }}>
      {props.label ? (
        <Text style={{ fontSize: 13, fontFamily: FONT.bold, color: c.textSecondary, marginBottom: 5 }}>
          {props.label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={c.textSecondary + '99'}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          {
            backgroundColor: c.card,
            color: c.text,
            borderWidth: focused ? 1.5 : 1,
            borderColor: focused ? c.accent : c.inputBorder,
            borderRadius: 6,
            paddingHorizontal: 12,
            paddingVertical: 9,
            fontSize: 15,
            fontFamily: FONT.regular,
          },
          props.multiline ? { minHeight: 88, textAlignVertical: 'top' } : null,
          props.style,
        ]}
      />
    </View>
  );
}

// ---------- states ----------

/** Branded loading state: pulsing compass mark over the app name. */
export function Loading({ label }: { label?: string }) {
  const c = useColors();
  const [pulse] = useState(() => new Animated.Value(0));

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background, gap: 16 }}>
      <Animated.View
        style={{
          width: 68,
          height: 68,
          borderRadius: 34,
          backgroundColor: c.accent,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale }],
          opacity,
        }}>
        <Ionicons name="compass" size={38} color="#FFFFFF" />
      </Animated.View>
      <Text style={{ fontFamily: FONT.black, fontSize: 16, color: c.text, letterSpacing: 0.3 }}>
        Terrapin Class Compass
      </Text>
      <ActivityIndicator color={c.accent} />
      {label ? <Text style={{ color: c.textSecondary, fontFamily: FONT.regular, fontSize: 13 }}>{label}</Text> : null}
    </View>
  );
}

export function ErrorBox({ message }: { message: string }) {
  const c = useColors();
  return (
    <View
      style={{
        backgroundColor: c.danger + '10',
        borderLeftWidth: 3,
        borderLeftColor: c.danger,
        borderRadius: 6,
        padding: 12,
        marginVertical: 8,
        flexDirection: 'row',
        gap: 8,
        alignItems: 'flex-start',
      }}>
      <Ionicons name="alert-circle" size={17} color={c.danger} style={{ marginTop: 1 }} />
      <Text style={{ color: c.danger, fontSize: 13.5, fontFamily: FONT.regular, flex: 1, lineHeight: 19 }}>
        {message}
      </Text>
    </View>
  );
}
