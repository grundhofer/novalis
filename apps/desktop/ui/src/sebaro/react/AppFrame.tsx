import type { ReactNode } from "react";

type Props = {
  /** the name of the frame as a view (data-sb-view): the check of a view counts its primary actions */
  name: string;
  /** two panes from 840 px: a list at the start, what it opens at the end */
  split?: boolean;
  /** a sub-view is open: on a phone it stands alone, with its way back and without the navigation */
  sub?: boolean;
  /** the name of the navigation */
  navLabel: string;
  /** the product's sign tile; it shows above the places where the navigation is the rail */
  tile: ReactNode;
  /** the three to five top-level places: links with the class sb-bottom-nav__item, icon and word */
  places: ReactNode;
  /** the panes: each one a view */
  children: ReactNode;
};

/** The app frame. Below 840 px of its own width: one pane and the navigation at the bottom. From 840 px: the same
 *  navigation as a rail at the edge and one pane, or two. The place around the frame gives it its height. */
export function AppFrame({ name, split, sub, navLabel, tile, places, children }: Props) {
  return (
    <div
      className={split ? "sb-app-frame sb-app-frame--split" : "sb-app-frame"}
      data-sb-pane={split && sub ? "end" : undefined}
      data-sb-view={name}
      data-sb-primary-expected="0"
    >
      <div className="sb-app-frame__body">
        {children}
        {/* last in the markup, first on the screen from 840 px */}
        <nav
          className={
            sub && !split
              ? "sb-bottom-nav sb-app-frame__rail sb-app-frame__rail--sub"
              : "sb-bottom-nav sb-app-frame__rail"
          }
          aria-label={navLabel}
        >
          {tile}
          {places}
        </nav>
      </div>
    </div>
  );
}
