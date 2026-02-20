import type { LucideIcon } from "lucide-react";
import {
  FileText,
  Library,
  Layers,
  Puzzle,
  Palette,
  Image,
  FileOutput,
  PenTool,
  Table,
  Shapes,
  File
} from "lucide-react";

export const fileIconMapping: Record<string, LucideIcon> = {
  ".tex": FileText,
  ".cls": Layers,
  ".sty": Puzzle,
  ".bib": Library,
  ".bst": Palette,
  ".png": Image,
  ".jpg": Image,
  ".jpeg": Image,
  ".gif": Image,
  ".svg": PenTool,
  ".pdf": FileOutput,
  ".eps": FileOutput,
  ".ps": FileOutput,
  ".txt": FileText,
  ".md": FileText,
  ".csv": Table,
  ".dat": Table,
  ".tikz": Shapes,
  ".pgf": Shapes,
};


interface FileIconProps {
    extension: string;
    className: string | undefined;
}
export default function FileIcon({ extension, className }: FileIconProps) {
    const trimmed = extension.trim().toLowerCase()
    const ext = trimmed.startsWith(".") ? trimmed : `.${trimmed}`
    const IconComponent = fileIconMapping[ext]
    return IconComponent ? <IconComponent className={className}/> : <File className={className}/>
}