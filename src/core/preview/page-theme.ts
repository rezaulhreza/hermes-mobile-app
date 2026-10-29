/** The colours of the app that a page takes. The palette of the theme has these and more. */
export interface PageColours {
  bg: string
  paper: string
  ink: string
  muted: string
  line: string
  soft: string
  accentFill: string
  onAccent: string
}

/**
 * The colours of a page the phone shows, from the colours of the app.
 *
 * A page that the agent writes uses the theme variables of the Hermes desktop
 * app (`var(--foreground)`, `var(--card)`, `var(--border)`). A WebView has
 * none of them, so such a page loses its text, card and line colours. The
 * script defines them from the palette, unless the page defines them itself.
 *
 * In dark mode it also deals with a page that paints no background: the dark
 * app shows through it, and text that is dark on that ground cannot be read.
 *  - A page that uses those variables gets the ground and the text colour of
 *    the app, because it was written for them.
 *  - A page with the default black text gets a dark ground and the light text
 *    of the app. When any part of the page has a background of its own, the
 *    text is not turned light: it could land on a light card. That page gets a
 *    white ground instead.
 *  - A page with its own dark text gets a white ground.
 *  - A page with its own light text is left as it is.
 * A page that paints its own background is never changed.
 */
export function pageThemeScript(palette: PageColours, dark: boolean): string {
  const variables = {
    background: palette.bg,
    foreground: palette.ink,
    card: palette.paper,
    'card-foreground': palette.ink,
    popover: palette.paper,
    'popover-foreground': palette.ink,
    muted: palette.soft,
    'muted-foreground': palette.muted,
    border: palette.line,
    input: palette.line,
    accent: palette.accentFill,
    'accent-foreground': palette.onAccent,
    primary: palette.accentFill,
    'primary-foreground': palette.onAccent,
    ring: palette.accentFill
  }

  const rules = Object.entries(variables)
    .map(([name, value]) => `--${name}: ${value};`)
    .join(' ')

  return `(function () {
  try {
    var doc = document;
    var root = doc.documentElement;
    var body = doc.body;

    if (!body) {
      return;
    }

    var add = function (css) {
      var rule = doc.createElement('style');
      rule.textContent = css;
      (doc.head || root).appendChild(rule);
    };
    var style = function (element) { return getComputedStyle(element); };

    // A page that has no variables of its own and uses the names of the host app is made for those variables.
    var defined = !style(root).getPropertyValue('--foreground').trim() && !style(root).getPropertyValue('--background').trim();
    var themed = defined && /var\\(--(foreground|background|card|border|muted-foreground)\\b/.test(root.outerHTML);

    if (defined) {
      add(':root { ${rules} }');
    }

    if (!${dark} || doc.querySelector('meta[name="color-scheme"]')) {
      return;
    }

    var clear = function (colour) { return colour === 'rgba(0, 0, 0, 0)' || colour === 'transparent'; };

    if (!clear(style(root).backgroundColor) || !clear(style(body).backgroundColor)) {
      return;
    }

    if (themed) {
      add(':root { color-scheme: dark; background: ${palette.bg}; color: ${palette.ink}; }');

      return;
    }

    var channels = (style(body).color.match(/[\\d.]+/g) || [0, 0, 0]).map(Number);
    var light = (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255 > 0.5;

    if (light) {
      return;
    }

    var painted = false;
    var parts = body.querySelectorAll('*');

    for (var index = 0; index < parts.length && index < 400 && !painted; index += 1) {
      painted = !clear(style(parts[index]).backgroundColor);
    }

    var plain = channels[0] === 0 && channels[1] === 0 && channels[2] === 0;

    if (plain && !painted) {
      add(':root { color-scheme: dark; background: ${palette.bg}; color: ${palette.ink}; } a { color: #8ab4f8; } a:visited { color: #c58af9; }');
    } else {
      add(':root { background: #ffffff; }');
    }
  } catch (error) {}
})();
true;`
}
