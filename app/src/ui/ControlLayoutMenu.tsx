import { CONTROL_LAYOUTS, type ControlLayout } from "./controlLayout";

interface ControlLayoutMenuProps {
    readonly value: ControlLayout;
    readonly onChange: (layout: ControlLayout) => void;
}

/** メニューの「操作」: 両手・片手 A・片手 B から選ぶ */
export const ControlLayoutMenu = ({
    value,
    onChange,
}: ControlLayoutMenuProps) => (
    <section className="gbc-menu-section">
        <h2 className="gbc-menu-heading" id="gbc-control-layout-heading">
            操作
        </h2>
        <div
            className="gbc-menu-list"
            role="radiogroup"
            aria-labelledby="gbc-control-layout-heading"
        >
            {CONTROL_LAYOUTS.map(layout => {
                const current = layout.value === value;
                return (
                    <button
                        key={layout.value}
                        type="button"
                        role="radio"
                        aria-checked={current}
                        className="gbc-menu-item gbc-menu-choice"
                        data-current={current || undefined}
                        onClick={() => onChange(layout.value)}
                    >
                        <span className="gbc-menu-choice-text">
                            <span className="gbc-menu-item-name">
                                {layout.label}
                            </span>
                            <span className="gbc-menu-choice-description">
                                {layout.description}
                            </span>
                        </span>
                        {current && (
                            <span className="gbc-menu-badge">選択中</span>
                        )}
                    </button>
                );
            })}
        </div>
        <p className="gbc-menu-note">片手は右手で持つ前提の配置です。</p>
    </section>
);

export default ControlLayoutMenu;
