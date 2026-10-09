import type { RefObject } from 'react';
import type { ReaderSettings } from '../../types/reader';

interface SettingsPanelProps {
  open: boolean;
  settings: ReaderSettings;
  onChange: (next: ReaderSettings) => void;
  panelRef?: RefObject<HTMLElement>;
}

export function SettingsPanel({
  open,
  settings,
  onChange,
  panelRef
}: SettingsPanelProps) {
  return (
    <aside
      ref={panelRef}
      className={`settings-panel ${open ? 'open' : ''}`}
    >
      <div className="settings-panel-inner">
        <div className="settings-group">
          <label>
            <span>Font size</span>
            <input
              type="range"
              min="16"
              max="30"
              step="1"
              value={settings.fontSize}
              onChange={(event) =>
                onChange({
                  ...settings,
                  fontSize: Number(event.target.value)
                })
              }
            />
          </label>
        </div>

        <div className="settings-group">
          <label>
            <span>Line height</span>
            <input
              type="range"
              min="1.35"
              max="2.1"
              step="0.05"
              value={settings.lineHeight}
              onChange={(event) =>
                onChange({
                  ...settings,
                  lineHeight: Number(event.target.value)
                })
              }
            />
          </label>
        </div>

        <div className="settings-group">
          <label>
            <span>Horizontal padding</span>
            <input
              type="range"
              min="14"
              max="48"
              step="1"
              value={settings.horizontalPadding}
              onChange={(event) =>
                onChange({
                  ...settings,
                  horizontalPadding: Number(event.target.value)
                })
              }
            />
          </label>
        </div>

        <div className="settings-group">
          <label className="settings-checkbox">
            <span>Hyphenation</span>
            <input type="checkbox" checked={settings.hyphenation ?? false}
              onChange={(event) => onChange({ ...settings, hyphenation: event.target.checked })} />
          </label>
        </div>

        <div className="settings-group">
          <label className="settings-checkbox">
            <span>Word animation</span>
            <input type="checkbox" checked={settings.wordAnimation ?? false}
              onChange={(event) => onChange({ ...settings, wordAnimation: event.target.checked })} />
          </label>
        </div>

        <div className="settings-group">
          <label className="settings-checkbox">
            <span>Background animation</span>
            <input type="checkbox" checked={settings.backgroundAnimation ?? false}
              onChange={(event) => onChange({ ...settings, backgroundAnimation: event.target.checked })} />
          </label>
        </div>

        <div className="settings-group">
          <span>Theme</span>
          <div className="theme-picker" role="group" aria-label="Color theme">
            {(['light', 'sepia', 'dark', 'mist', 'sage', 'rose', 'midnight'] as const).map((theme) => (
              <button
                key={theme}
                type="button"
                className={`theme-preview theme-${theme}${settings.theme === theme ? ' active' : ''}`}
                aria-pressed={settings.theme === theme}
                aria-label={`${theme[0].toUpperCase()}${theme.slice(1)} theme`}
                onClick={() =>
                  onChange({
                    ...settings,
                    theme
                  })
                }
              >
                <span className="theme-preview-type" aria-hidden="true">Aa</span>
                <span className="theme-preview-line" aria-hidden="true" />
                <span className="theme-preview-name">{theme}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
