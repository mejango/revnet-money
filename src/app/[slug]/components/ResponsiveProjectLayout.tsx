"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { ProjectMenu } from "./ProjectMenu";

export function ResponsiveProjectLayout({
  sidebar,
  activity,
  preMenu,
  children,
}: {
  sidebar: ReactNode;
  activity: ReactNode;
  preMenu?: ReactNode;
  children: ReactNode;
}) {
  const segment = useSelectedLayoutSegment();
  const [isSingleColumn, setIsSingleColumn] = useState(false);
  const [activitySelected, setActivitySelected] = useState(segment === null);

  useEffect(() => {
    const singleColumnQuery = window.matchMedia("(max-width: 1279px)");
    const apply = () => setIsSingleColumn(singleColumnQuery.matches);
    apply();
    singleColumnQuery.addEventListener("change", apply);
    return () => singleColumnQuery.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (segment) setActivitySelected(false);
  }, [segment]);

  const activityActive = isSingleColumn && activitySelected;

  return (
    <div className="mb-10 flex w-full flex-col px-4 pb-5 sm:container xl:flex-row xl:gap-10">
      <aside className="contents xl:flex xl:w-[300px] xl:shrink-0 xl:flex-col">
        <div data-project-layout="sidebar" className="order-1 xl:order-none">
          {sidebar}
        </div>
        <div className={`order-3 ${activityActive ? "block" : "hidden"} xl:order-none xl:block`}>
          {activity}
        </div>
      </aside>

      <div className="contents xl:mx-auto xl:flex xl:min-w-0 xl:max-w-4xl xl:flex-1 xl:flex-col xl:gap-6 xl:pb-10">
        {preMenu ? (
          <div
            className={`order-3 pt-6 ${
              activityActive ? "hidden" : "block"
            } xl:order-none xl:block xl:pt-0`}
          >
            {preMenu}
          </div>
        ) : null}

        <div data-project-layout="menu" className="order-2 mt-2 xl:order-none xl:mt-0">
          <ProjectMenu
            mobileActivityActive={activityActive}
            onMobileActivityChange={setActivitySelected}
          />
        </div>

        <div
          className={`order-4 pt-6 ${
            activityActive ? "hidden" : "block"
          } xl:order-none xl:block xl:pt-0`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
