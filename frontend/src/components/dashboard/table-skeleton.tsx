import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  columns: number;
  rows?: number;
}

export function TableSkeleton({ columns, rows = 5 }: TableSkeletonProps) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr
          key={rowIndex}
          className="border-b border-border-subtle last:border-b-0"
        >
          {Array.from({ length: columns }, (_, colIndex) => (
            <td key={colIndex} className="px-3 py-3 first:pl-5 last:pr-5">
              <Skeleton
                className="h-4 w-full"
                style={{ maxWidth: colIndex === 0 ? 80 : colIndex === 4 ? 60 : 100 }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
