import { StyleSheet, Text, View } from 'react-native';
import { type LegalBlock, type LegalDocument } from '@homefarm/contracts';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * The privacy policy and the terms, read on the handset.
 *
 * ## Why they are in the app at all, rather than a link
 *
 * **A farm with no server has to be able to read what it agreed to.** D14 makes
 * a build with no origin an ordinary state, not a broken one, and the whole
 * premise is that the app works with nothing configured — so a policy that
 * lives only at a URL is one a farm may be unable to open. Google Play needs
 * the URL as well, which is why the server renders the same document; the text
 * itself lives in `contracts/legal.ts` so the two cannot drift.
 *
 * ## One screen for both documents
 *
 * They differ only in their content, and two screens would be the same layout
 * written twice — with the second one getting the next improvement and the
 * first not. The route carries which document to draw.
 */
export function LegalScreen({ document }: { document: LegalDocument }): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Screen title={document.title} back>
      {/**
        * The date first, because a policy with no date is one nobody can
        * reason about — "is this the version I agreed to" has no answer
        * without it.
        */}
      <Text style={[styles.effective, { color: colors.muted }]}>
        Effective {document.effective}
      </Text>

      {document.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </Screen>
  );
}

/**
 * One block, and every kind handled.
 *
 * The switch is exhaustive over `LegalBlock`, so a kind added to the contract
 * fails the compiler here rather than rendering as nothing — which on a legal
 * document is the failure that matters and the one nobody would notice, since
 * almost nobody reads it twice.
 */
function Block({ block }: { block: LegalBlock }): React.ReactElement {
  const { colors } = useTheme();

  switch (block.kind) {
    case 'heading':
      return (
        <Text style={[styles.heading, { color: colors.ink }]} accessibilityRole="header">
          {block.text}
        </Text>
      );

    case 'paragraph':
      return (
        <Text style={[styles.paragraph, { color: colors.ink }]}>{block.text}</Text>
      );

    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.item}>
              {/* A drawn bullet rather than a character in the string, so the
                  text a screen reader announces is the sentence and not a
                  punctuation mark before it. */}
              <Text style={[styles.bullet, { color: colors.muted }]} accessibilityElementsHidden>
                •
              </Text>
              <Text style={[styles.paragraph, styles.itemText, { color: colors.ink }]}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'contact':
      /**
       * Not a link, deliberately.
       *
       * A tappable address needs a mail client, and a farm handset may have
       * none — a control that does nothing on tap is the dead affordance this
       * app refuses elsewhere. The address is selectable instead, which is what
       * somebody actually needs to do with it: copy it.
       */
      return (
        <Panel label="Contact">
          <Body>{block.label}</Body>
          <Text selectable style={[styles.email, { color: colors.ink }]}>
            {block.email}
          </Text>
        </Panel>
      );
  }
}

const styles = StyleSheet.create({
  effective: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: SPACE.md,
  },
  heading: {
    fontFamily: FONTS.display,
    fontSize: TYPE.lede,
    marginTop: SPACE.lg,
    marginBottom: SPACE.xs,
  },
  paragraph: {
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
    lineHeight: TYPE.body * 1.45,
    marginBottom: SPACE.sm,
  },
  list: { marginBottom: SPACE.sm },
  item: { flexDirection: 'row', gap: SPACE.sm },
  bullet: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.45 },
  itemText: { flex: 1 },
  email: {
    fontFamily: FONTS.data,
    fontSize: TYPE.body,
    marginTop: SPACE.xs,
  },
});
