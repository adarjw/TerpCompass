/** Campus building database: view/edit entrance notes and walking overrides. */

import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';

import {
  Body,
  Button,
  Card,
  ErrorBox,
  Field,
  Icon,
  Row,
  Screen,
  Subtitle,
  FONT,
} from '@/components/ui';
import { locationsRepo } from '@/db/repo';
import { makeId } from '@/lib/ids';
import type { CampusLocation } from '@/lib/types';
import { bestMapUrl } from '@/lib/walking';
import { useApp } from '@/state/AppContext';

export default function BuildingsScreen() {
  const { db, version, bump } = useApp();
  const [locations, setLocations] = useState<CampusLocation[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<CampusLocation>>({});
  const [adding, setAdding] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!db) return;
        setLocations(await locationsRepo.all(db));
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version bumps trigger a reload
    }, [db, version]),
  );

  const startEdit = (loc: CampusLocation) => {
    setEditing(loc.id);
    setDraft({ ...loc });
  };

  const startAdd = () => {
    setAdding(true);
    setDraft({ name: '', abbreviation: '', lat: null, lon: null });
  };

  const save = async () => {
    if (!db) return;
    if (!draft.name?.trim()) {
      setError('Building name is required.');
      return;
    }
    const lat = draft.lat != null && String(draft.lat) !== '' ? Number(draft.lat) : null;
    const lon = draft.lon != null && String(draft.lon) !== '' ? Number(draft.lon) : null;
    if ((lat !== null && !Number.isFinite(lat)) || (lon !== null && !Number.isFinite(lon))) {
      setError('Latitude/longitude must be numbers.');
      return;
    }
    const walkOverride =
      draft.walkOverrideMin != null && String(draft.walkOverrideMin) !== ''
        ? Number(draft.walkOverrideMin)
        : undefined;
    const loc: CampusLocation = {
      id: editing ?? makeId(),
      name: draft.name.trim(),
      abbreviation: (draft.abbreviation ?? '').trim(),
      lat,
      lon,
      entranceNotes: draft.entranceNotes?.trim() || undefined,
      roomNotes: draft.roomNotes?.trim() || undefined,
      walkOverrideMin: walkOverride,
    };
    await locationsRepo.upsert(db, loc);
    setEditing(null);
    setAdding(false);
    setError(null);
    bump();
  };

  const remove = async (id: string) => {
    if (!db) return;
    await locationsRepo.remove(db, id);
    bump();
  };

  const form = (
    <Card>
      {error ? <ErrorBox message={error} /> : null}
      <Field label="Name *" value={draft.name ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))} />
      <Field
        label="Abbreviation"
        value={draft.abbreviation ?? ''}
        onChangeText={(v) => setDraft((d) => ({ ...d, abbreviation: v }))}
        autoCapitalize="characters"
      />
      <Row>
        <View style={{ flex: 1 }}>
          <Field
            label="Latitude"
            value={draft.lat != null ? String(draft.lat) : ''}
            onChangeText={(v) => setDraft((d) => ({ ...d, lat: v as unknown as number }))}
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Longitude"
            value={draft.lon != null ? String(draft.lon) : ''}
            onChangeText={(v) => setDraft((d) => ({ ...d, lon: v as unknown as number }))}
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </Row>
      <Field
        label="Entrance notes"
        value={draft.entranceNotes ?? ''}
        onChangeText={(v) => setDraft((d) => ({ ...d, entranceNotes: v }))}
        multiline
        placeholder="Main doors face the mall; lecture halls on ground floor."
      />
      <Field
        label="Room-location notes"
        value={draft.roomNotes ?? ''}
        onChangeText={(v) => setDraft((d) => ({ ...d, roomNotes: v }))}
        multiline
      />
      <Field
        label="Manual walking-time override (minutes)"
        value={draft.walkOverrideMin != null ? String(draft.walkOverrideMin) : ''}
        onChangeText={(v) => setDraft((d) => ({ ...d, walkOverrideMin: v as unknown as number }))}
        keyboardType="number-pad"
        placeholder="Leave blank to use distance estimate"
      />
      <Row>
        <View style={{ flex: 1 }}>
          <Button label="Save" onPress={save} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Cancel"
            kind="ghost"
            onPress={() => {
              setEditing(null);
              setAdding(false);
              setError(null);
            }}
          />
        </View>
      </Row>
    </Card>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Subtitle>Campus buildings ({locations.length})</Subtitle>
        <Body secondary style={{ marginBottom: 8 }}>
          No map API is used — walking time comes from these coordinates, or your manual override.
        </Body>
        {adding ? form : <Button label="Add building" kind="secondary" onPress={startAdd} />}
        {locations.map((loc) =>
          editing === loc.id ? (
            <View key={loc.id}>{form}</View>
          ) : (
            <Card key={loc.id} style={{ paddingVertical: 12 }}>
              {/* Name centered across the top, actions beneath it, then the
                  description gets the full card width. */}
              <Body style={{ fontFamily: FONT.bold, fontSize: 16, textAlign: 'center' }}>
                {loc.name} {loc.abbreviation ? `(${loc.abbreviation})` : ''}
              </Body>
              <Row style={{ justifyContent: 'center', marginTop: 8, marginBottom: 4 }}>
                <View style={{ flex: 1, maxWidth: 150 }}>
                  <Button
                    label="Directions"
                    kind="tonal"
                    compact
                    icon="navigate-outline"
                    onPress={() => Linking.openURL(bestMapUrl(loc, loc.name, Platform.OS === 'ios'))}
                  />
                </View>
                <View style={{ flex: 1, maxWidth: 150 }}>
                  <Button label="Edit" kind="secondary" compact icon="create-outline" onPress={() => startEdit(loc)} />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${loc.name}`}
                  onPress={() => remove(loc.id)}
                  hitSlop={6}
                  style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.5 : 1 })}>
                  <Icon name="trash-outline" size={17} />
                </Pressable>
              </Row>
              {loc.entranceNotes ? <Body secondary>{loc.entranceNotes}</Body> : null}
              {loc.roomNotes ? (
                <Body secondary style={{ fontSize: 13 }}>
                  {loc.roomNotes}
                </Body>
              ) : null}
              <Body secondary style={{ fontSize: 12, marginTop: 4 }}>
                {loc.walkOverrideMin != null
                  ? `Manual walk time: ${loc.walkOverrideMin} min`
                  : loc.lat != null
                    ? `${loc.lat.toFixed(4)}, ${loc.lon?.toFixed(4)}`
                    : 'No coordinates set'}
              </Body>
            </Card>
          ),
        )}
      </ScrollView>
    </Screen>
  );
}
