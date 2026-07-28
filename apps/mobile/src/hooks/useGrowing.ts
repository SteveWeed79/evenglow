import { useCallback, useEffect, useState } from 'react';
import {
  type Bed,
  listBeds,
  listPlantings,
  type Planting,
  readSite,
  type Site,
} from '@steading/core/read/growing';
import { subscribe } from '@steading/core/sync/engine';

/**
 * The growing view, from the local projection.
 *
 * Re-reads on every engine publish, which happens after every enqueue — so a
 * bed added in a polytunnel with no signal appears without waiting for
 * anything, exactly as a group does under Stock.
 */

export interface GrowingView {
  site: Site | null;
  beds: Bed[];
  plantings: Planting[];
  loading: boolean;
}

export function useGrowing(): GrowingView {
  const [view, setView] = useState<GrowingView>({
    site: null,
    beds: [],
    plantings: [],
    loading: true,
  });

  const refresh = useCallback(async () => {
    const [site, beds, plantings] = await Promise.all([readSite(), listBeds(), listPlantings()]);
    setView({ site, beds, plantings, loading: false });
  }, []);

  useEffect(() => subscribe(() => void refresh()), [refresh]);

  return view;
}
