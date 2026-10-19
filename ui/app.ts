import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { mountGallery } from './gallery';

const app = new App({ name: 'WhatsApp image gallery', version: '1.0.0' }, {}, { autoResize: true });
const gallery = mountGallery(document.querySelector<HTMLElement>('#gallery')!, app);

app.onhostcontextchanged = context => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
  if (context.safeAreaInsets) {
    const { top, right, bottom, left } = context.safeAreaInsets;
    const inset = (value: number) => `${Number.isFinite(value) ? Math.max(0, value) : 0}px`;
    document.body.style.padding = [top, right, bottom, left].map(inset).join(' ');
  }
};
app.onteardown = async () => {
  document.querySelector<HTMLDialogElement>('dialog[open]')?.close();
  return {};
};

// Every notification handler is installed before the initialization handshake.
app.connect().then(() => {
  const context = app.getHostContext();
  if (context) app.onhostcontextchanged?.(context);
}).catch(() => gallery.showError());
