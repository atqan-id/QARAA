import { LitElement, html } from 'lit';
import type { QaraaSession } from '@atqan/qaraa-client';
import { QaraaSessionController } from '@atqan/qaraa-lit';

export class QaraaIsland extends LitElement {
  session!: QaraaSession;
  private qaraa?: QaraaSessionController;
  override connectedCallback() { this.qaraa ??= new QaraaSessionController(this, this.session); super.connectedCallback(); }
  override render() { return html`<output>${this.qaraa?.snapshot.revision ?? 0}</output>`; }
}
if (typeof customElements !== 'undefined' && !customElements.get('qaraa-island')) customElements.define('qaraa-island', QaraaIsland);
