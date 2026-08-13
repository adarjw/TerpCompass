/**
 * <Image> wrapper for a sandbox-stored photo. On native the stored URI is
 * already a real file:// path Image can load directly. On web it may be a
 * synthetic "sandbox-blob://" reference (see services/files.ts) that needs
 * an async DB read to turn into a displayable data: URI first.
 */

import React, { useEffect, useState } from 'react';
import { Image, View, type ImageResizeMode, type ImageStyle, type StyleProp } from 'react-native';
import { resolveSandboxImageUri } from '@/services/files';
import { useApp } from '@/state/AppContext';

export function SandboxImage({
  uri,
  style,
  resizeMode = 'contain',
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
}) {
  const { db } = useApp();
  const [result, setResult] = useState<{ forUri: string; resolved: string } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!db) return;
    resolveSandboxImageUri(db, uri).then((resolved) => {
      if (alive) setResult({ forUri: uri, resolved });
    });
    return () => {
      alive = false;
    };
  }, [db, uri]);

  if (!result || result.forUri !== uri) return <View style={style} />;
  return <Image source={{ uri: result.resolved }} style={style} resizeMode={resizeMode} />;
}
