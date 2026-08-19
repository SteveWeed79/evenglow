import { Text, View } from 'react-native';
import { formatMass } from '@homefarm/contracts';
import { readNumbers } from '@homefarm/core/read/numbers';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useUnits } from '../hooks/useUnits';
import { useTheme } from '../theme/ThemeProvider';
import { styles } from './NumbersScreen';

/**
 * What came off the ground, by crop and by bed.
 *
 * This is what "The numbers" used to be in its entirety, moved one level down
 * so the overview can be about the farm. Nothing here changed on the way — it
 * reads the same `readNumbers`, shows the same two sections, and answers the
 * same question. Invariant 13 in a refactor: a screen that got a new neighbour
 * did not get quietly smaller.
 *
 * ## By crop, not by variety
 *
 * Sungold and Brandywine are both tomatoes, and "how did tomatoes do" is the
 * question somebody asks in August. The variety is on the planting for anybody
 * who wants it.
 */

export function CropNumbersScreen(): React.ReactElement {
  const numbers = useLive(readNumbers);
  const units = useUnits();
  const { colors } = useTheme();

  if (numbers === null) return <Loading title="Crops" />;

  const { now, before } = numbers;

  if (now.plantings === 0 && before === null) {
    return <Missing title="Crops" what="Anything planted" />;
  }

  return (
    <Screen title="Crops" subtitle={String(now.season)} back>
      <Panel label="The season so far">
        <View style={styles.pair}>
          <Text style={[styles.pairLabel, { color: colors.muted }]}>Times picked</Text>
          <View style={styles.pairValues}>
            <Text style={[styles.now, { color: colors.ink }]}>{now.picks}</Text>
            <Text style={[styles.before, { color: colors.muted }]}>
              {before === null ? 'first season' : `${before.picks} by now last year`}
            </Text>
          </View>
        </View>
        <View style={styles.pair}>
          <Text style={[styles.pairLabel, { color: colors.muted }]}>Plantings</Text>
          <View style={styles.pairValues}>
            <Text style={[styles.now, { color: colors.ink }]}>{now.plantings}</Text>
            <Text style={[styles.before, { color: colors.muted }]}>
              {before === null ? 'first season' : `${before.plantings} by now last year`}
            </Text>
          </View>
        </View>
      </Panel>

      {/* What a farm runs decides what it sees — a section with nothing in it
          is a question mark rather than an answer. */}
      {now.byCrop.length === 0 ? null : (
        <Panel label="By crop">
          {now.byCrop.map((row) => {
            const last = before?.byCrop.find((c) => c.crop === row.crop);
            return (
              <View key={row.crop} style={styles.row}>
                <Text style={[styles.rowName, { color: colors.ink }]}>{row.crop}</Text>
                <View style={styles.rowValues}>
                  <Text style={[styles.now, { color: colors.ink }]}>
                    {row.massUg > 0 ? formatMass(row.massUg, units) : `${row.count}`}
                  </Text>
                  <Text style={[styles.before, { color: colors.muted }]}>
                    {last === undefined
                      ? before === null
                        ? ''
                        : 'not grown last year'
                      : `was ${last.massUg > 0 ? formatMass(last.massUg, units) : last.count}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </Panel>
      )}

      {now.byBed.length === 0 ? null : (
        <Panel label="By bed">
          {now.byBed.map((row) => {
            const last = before?.byBed.find((b) => b.bedId === row.bedId);
            return (
              <View key={row.bedId} style={styles.row}>
                <View style={styles.rowWords}>
                  <Text style={[styles.rowName, { color: colors.ink }]}>{row.bed}</Text>
                  {row.crops.length === 0 ? null : (
                    <Text style={[styles.rowCrops, { color: colors.muted }]}>
                      {row.crops.join(' · ')}
                    </Text>
                  )}
                </View>
                <View style={styles.rowValues}>
                  <Text style={[styles.now, { color: colors.ink }]}>
                    {row.massUg > 0 ? formatMass(row.massUg, units) : `${row.count}`}
                  </Text>
                  <Text style={[styles.before, { color: colors.muted }]}>
                    {last === undefined
                      ? ''
                      : `was ${last.massUg > 0 ? formatMass(last.massUg, units) : last.count}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </Panel>
      )}

      <Panel label="What this counts">
        <Body>
          Everything picked and recorded against a planting, by the season it was planted in. A bed
          with a planting and nothing off it yet is still listed — that is a question worth seeing.
        </Body>
      </Panel>
    </Screen>
  );
}
