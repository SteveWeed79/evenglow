import { StyleSheet, Text, View } from 'react-native';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { FONT_LICENCES, OFL_1_1 } from '../theme/licences';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * The licences that ship with the app.
 *
 * Here because the typefaces are bundled and the SIL Open Font License says
 * its text travels with the font software. The `OFL-*.txt` files beside the
 * fonts cover anyone reading the repository; Metro does not package them, so
 * without this screen a handset would carry the fonts and not the licence.
 *
 * Reached from Settings and not linked from anywhere anyone is working. It is
 * an obligation rather than a feature, and the honest place for it is the
 * bottom of the screen nobody visits during chores.
 */
export function LicencesScreen(): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Screen title="Licences" back>
      <Panel label="Typefaces">
        <Body>
          The type in this app is set in three open-source families, bundled so that nothing
          here needs a signal to look right.
        </Body>

        {FONT_LICENCES.map((licence) => (
          <View key={licence.family} style={styles.entry}>
            <Text style={[styles.family, { color: colors.ink }]}>{licence.family}</Text>
            <Text style={[styles.notice, { color: colors.muted }]}>{licence.notice}</Text>
            <Text style={[styles.notice, { color: colors.muted }]}>{licence.source}</Text>
          </View>
        ))}
      </Panel>

      <Panel label="SIL Open Font License 1.1">
        {/* Verbatim, and selectable so it can be copied rather than
            transcribed. All three families are under the same version. */}
        <Text style={[styles.licence, { color: colors.ink }]} selectable>
          {OFL_1_1}
        </Text>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  entry: { gap: 2, marginTop: SPACE.sm },
  family: { fontFamily: FONTS.body, fontSize: TYPE.body },
  notice: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
  licence: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    lineHeight: TYPE.label * 1.5,
  },
});
