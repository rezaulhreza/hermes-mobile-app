/**
 * For a page that sets no colours of its own. Such a page has a clear
 * background and the default black text, so in dark mode the black words sit
 * on the dark app behind the page. The script gives the page the background
 * and the text colour of the app, and asks the browser for its dark defaults
 * (link colours, form controls). A page that sets its own background or its
 * own text colour is left as its author made it.
 */
export function darkPageScript(background: string, ink: string): string {
  return `(function () {
  try {
    var doc = document;
    var root = doc.documentElement;
    var body = doc.body;

    if (!body || doc.querySelector('meta[name="color-scheme"]')) {
      return;
    }

    var style = function (element) { return getComputedStyle(element); };
    var clear = function (colour) { return colour === 'rgba(0, 0, 0, 0)' || colour === 'transparent'; };

    if (clear(style(root).backgroundColor) && clear(style(body).backgroundColor) && style(body).color === 'rgb(0, 0, 0)') {
      var meta = doc.createElement('meta');
      meta.name = 'color-scheme';
      meta.content = 'light dark';
      (doc.head || root).appendChild(meta);

      var rule = doc.createElement('style');
      rule.textContent = ':root { color-scheme: dark; background: ${background}; color: ${ink}; } a { color: #8ab4f8; } a:visited { color: #c58af9; }';
      (doc.head || root).appendChild(rule);
    }
  } catch (error) {}
})();
true;`
}
