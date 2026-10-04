"use client";

import { Popover } from "@base-ui/react/popover";
import { SettingsIcon, XIcon } from "lucide-react";
import { useId } from "react";

import {
  visualizers,
  type VisualizerId,
} from "@/components/infrastructure/visualizers";
import { Button } from "@/components/ui/button";
import { groupingModes, type GroupingMode } from "@/lib/layout-options";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LayoutSettingsProps = {
  grouping: GroupingMode;
  onGroupingChange: (grouping: GroupingMode) => void;
  visualizer: VisualizerId;
  onVisualizerChange: (visualizer: VisualizerId) => void;
};

export function LayoutSettings({
  grouping,
  onGroupingChange,
  visualizer,
  onVisualizerChange,
}: LayoutSettingsProps) {
  const visualizerId = useId();
  const groupingId = useId();

  return (
    // Keep canvas keyboard shortcuts from consuming settings interactions.
    <div onKeyDown={(event) => event.stopPropagation()}>
      <Popover.Root>
        <Popover.Trigger
          render={
            <Button
              variant="secondary"
              size="icon"
              className="border-white/10 bg-black/55 text-white backdrop-blur-sm hover:bg-white/15 hover:text-white"
              aria-label="Layout settings"
              title="Layout settings"
            />
          }
        >
          <SettingsIcon className="size-4" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            side="bottom"
            align="end"
            sideOffset={8}
            className="z-40"
          >
            <Popover.Popup className="w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none">
              <div className="mb-4 flex items-center justify-between gap-2">
                <Popover.Title className="text-sm font-medium">
                  Layout settings
                </Popover.Title>
                <Popover.Close render={<Button variant="ghost" size="icon-sm" />}>
                  <XIcon className="size-4" />
                  <span className="sr-only">Close layout settings</span>
                </Popover.Close>
              </div>

              <div className="space-y-2">
                <label htmlFor={groupingId} className="text-sm font-medium">
                  Grouping
                </label>
                <Select
                  items={groupingModes}
                  value={grouping}
                  onValueChange={(value) => {
                    if (value) onGroupingChange(value);
                  }}
                >
                  <SelectTrigger id={groupingId} aria-label="Grouping">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {groupingModes.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              <div className="mt-4 space-y-2 border-t border-border pt-4">
                <label htmlFor={visualizerId} className="text-sm font-medium">
                  Visualizer
                </label>
                <Select
                  items={visualizers.map(({ id, label }) => ({ value: id, label }))}
                  value={visualizer}
                  onValueChange={(value) => {
                    const selected = visualizers.find(({ id }) => id === value);
                    if (selected) onVisualizerChange(selected.id);
                  }}
                >
                  <SelectTrigger id={visualizerId} aria-label="Visualizer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {visualizers.map(({ id, label }) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
