import { useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  Copy,
  GitBranch,
  MousePointer2,
  Play,
  RefreshCcw,
  TerminalSquare,
} from 'lucide-react';
import { landingMedia, type LandingMediaDefinition } from './landingMedia';

const installCommand = 'npm install -g @mean-weasel/lineage@latest';

export function LandingPage() {
  const [copied, setCopied] = useState(false);

  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <a aria-label="Lineage home" className="landing-brand" href="#top">
          <span aria-hidden="true" className="landing-brand-mark">
            <span />
            <span />
            <span />
          </span>
          <span>LINEAGE</span>
        </a>
        <nav aria-label="Landing page">
          <a href="#loop">How it works</a>
          <a href="#features">What it enables</a>
          <a href="#install">Install</a>
        </nav>
        <a className="nav-cta" href="https://github.com/mean-weasel/lineage" rel="noreferrer" target="_blank">
          View on GitHub <ArrowDownRight aria-hidden="true" size={16} />
        </a>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-grid" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="hero-copy">
            <p className="section-index"><span>01</span> Human × agent creative work</p>
            <h1>The UX where humans and agents shape visual work together.</h1>
            <p className="hero-summary">
              Lineage is the shared visual workspace where humans and agents create, review, and evolve creative assets together.
            </p>
            <div className="hero-actions">
              <a className="primary-cta" href="#loop">
                See the collaboration loop <ArrowRight aria-hidden="true" size={18} />
              </a>
              <a className="text-cta" href="#install">Install Lineage</a>
            </div>
          </div>
          <div className="hero-media-wrap">
            <MediaSlot definition={landingMedia['hero-board']} hero />
            <div className="hero-proof-card proof-human">
              <MousePointer2 aria-hidden="true" size={17} />
              <span>Human chooses the next move</span>
            </div>
            <div className="hero-proof-card proof-agent">
              <TerminalSquare aria-hidden="true" size={17} />
              <span>Agent reads the same state</span>
            </div>
          </div>
        </section>

        <section className="loop-section" id="loop">
          <div className="loop-heading">
            <p className="section-index"><span>02</span> Context travels both ways</p>
            <h2>One creative state for humans and agents.</h2>
            <div className="loop-copy">
              <p className="loop-problem">Chat is the right UX for directing agent-driven creative work. But it isn’t built to hold the state of that work.</p>
              <p>Lineage preserves every asset, path, prompt, relationship, and decision in a shared record—precise enough for agents to retrieve through the CLI and organized visually for humans to review and direct.</p>
            </div>
          </div>

          <div className="interface-grid">
            <article className="interface-card agent-card">
              <div className="interface-number">A</div>
              <div>
                <p className="card-eyebrow">For agents</p>
                <h3>Never lose the state behind the work.</h3>
                <p>Every asset, path, prompt, iteration, and relationship stays available so the work can continue accurately.</p>
              </div>
              <MediaSlot definition={landingMedia['reroll-loop']} />
            </article>

            <div className="loop-bridge" aria-label="Assets, context, selections, and annotations move through one creative state">
              <span>Assets + context</span>
              <div className="bridge-line"><ArrowRight aria-hidden="true" size={18} /></div>
              <strong>ONE CREATIVE<br />STATE</strong>
              <div className="bridge-line reverse"><ArrowRight aria-hidden="true" size={18} /></div>
              <span>Selections + annotations</span>
            </div>

            <article className="interface-card human-card">
              <div className="interface-number">H</div>
              <div>
                <p className="card-eyebrow">For humans</p>
                <h3>Keep your creative history organized.</h3>
                <p>Review and compare the history, then use selections and annotations to direct the next iteration.</p>
              </div>
              <MediaSlot definition={landingMedia['selection-to-codex']} />
            </article>
          </div>
        </section>

        <section className="features-section" id="features">
          <div className="features-heading">
            <p className="section-index"><span>03</span> What it enables</p>
            <h2>Your creative history, ready to continue.</h2>
            <p>Keep the useful context behind every asset available, understandable, and ready for the next human or agent action.</p>
          </div>

          <div className="feature-grid">
            <Feature number="01" icon={<GitBranch />} title="Trace every iteration">
              Follow an asset from its origin through branches, selections, and final campaign formats.
            </Feature>
            <Feature number="02" icon={<MousePointer2 />} title="Continue from the exact asset">
              Select any useful point in the lineage and bring that context into the next agent session.
            </Feature>
            <Feature number="03" icon={<RefreshCcw />} title="Keep attempts and decisions attached">
              Review another pass without losing earlier results, prompts, relationships, or human direction.
            </Feature>
          </div>

          <div className="final-cta" id="install">
            <div>
              <p className="section-index"><span>→</span> Local-first and agent-ready</p>
              <h3>Give your creative work somewhere durable to live.</h3>
            </div>
            <div className="install-panel">
              <div className="install-command">
                <span aria-hidden="true">$</span>
                <code>{installCommand}</code>
                <button aria-label="Copy install command" onClick={() => void copyInstallCommand()} type="button">
                  {copied ? <Check aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="install-meta">
                <span>Local-first</span>
                <span>MIT licensed</span>
                <span>Codex plugin</span>
                <span>CLI access</span>
              </div>
              <a className="primary-cta dark" href="https://github.com/mean-weasel/lineage" rel="noreferrer" target="_blank">
                Explore Lineage on GitHub <ArrowDownRight aria-hidden="true" size={18} />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <a className="landing-brand" href="#top">
          <span aria-hidden="true" className="landing-brand-mark"><span /><span /><span /></span>
          <span>LINEAGE</span>
        </a>
        <p>The shared visual workspace for humans and agents.</p>
        <a href="https://github.com/mean-weasel/lineage" rel="noreferrer" target="_blank">GitHub <ArrowDownRight aria-hidden="true" size={14} /></a>
      </footer>
    </div>
  );
}

function MediaSlot({ definition, hero = false }: { definition: LandingMediaDefinition; hero?: boolean }) {
  if (definition.src && definition.kind === 'video') {
    return (
      <figure className={`media-slot media-slot-ready ${hero ? 'media-slot-hero' : ''}`} data-media-slot={definition.id}>
        <video aria-label={definition.description} autoPlay loop muted playsInline poster={definition.poster} src={definition.src} />
      </figure>
    );
  }

  if (definition.src) {
    return (
      <figure className={`media-slot media-slot-ready ${hero ? 'media-slot-hero' : ''}`} data-media-slot={definition.id}>
        <img alt={definition.description} src={definition.src} />
      </figure>
    );
  }

  return (
    <figure aria-label={`${definition.title}. Media placeholder: ${definition.description}`} className={`media-slot media-placeholder ${hero ? 'media-slot-hero' : ''}`} data-media-slot={definition.id}>
      <div className="placeholder-canvas" aria-hidden="true">
        <span className="placeholder-node node-root"><i /></span>
        <span className="placeholder-node node-a"><i /></span>
        <span className="placeholder-node node-b"><i /></span>
        <span className="placeholder-node node-c"><i /></span>
        <span className="placeholder-edge edge-a" />
        <span className="placeholder-edge edge-b" />
        <span className="placeholder-edge edge-c" />
      </div>
      <figcaption>
        <span className="media-eyebrow">{definition.eyebrow}</span>
        <strong>{definition.title}</strong>
        <small>{definition.description}</small>
      </figcaption>
      {definition.kind === 'video' && <span aria-hidden="true" className="play-badge"><Play fill="currentColor" size={14} /></span>}
    </figure>
  );
}

function Feature({ children, icon, number, title }: { children: string; icon: ReactNode; number: string; title: string }) {
  return (
    <article className="feature-card">
      <div className="feature-top"><span>{number}</span>{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}
