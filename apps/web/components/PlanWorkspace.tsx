'use client';

import { useState } from 'react';
import { ScheduleEditor } from '@/components/ScheduleEditor';
import { StudyCoach } from '@/components/StudyCoach';

/** The schedule and the plan it produces, so re-planning refreshes the result. */
export function PlanWorkspace() {
  const [generation, setGeneration] = useState(0);

  return (
    <div className="stack-lg">
      <ScheduleEditor onPlanned={() => setGeneration((n) => n + 1)} />
      <StudyCoach key={generation} />
    </div>
  );
}
