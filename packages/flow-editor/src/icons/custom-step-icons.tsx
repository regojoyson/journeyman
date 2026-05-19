import type { LucideIcon } from "lucide-react";
import {
  Bot, Brain, Sparkles, Wand2,
  Code2, Terminal, GitBranch, GitMerge,
  GitPullRequest, Bug, Hammer, Wrench,
  Cog, Workflow, Boxes, Package,
  FileText, FileCode, ClipboardCheck, ListChecks,
  Search, MessageSquare, Bell, Mail,
  Cpu, Database, Cloud, Shield,
  Lock, Key, Rocket, FlaskConical,
  Microscope, BookOpen, Pencil, PenLine,
  Eye, BarChart3, Activity, Puzzle,
} from "lucide-react";

import { CUSTOM_STEP_ICON_NAMES } from "@journeyman/core";

/**
 * Lucide component for each name in CUSTOM_STEP_ICON_NAMES.
 * Must stay in sync with that allowlist.
 */
export const CUSTOM_STEP_ICON_COMPONENTS: Record<string, LucideIcon> = {
  Bot, Brain, Sparkles, Wand2,
  Code2, Terminal, GitBranch, GitMerge,
  GitPullRequest, Bug, Hammer, Wrench,
  Cog, Workflow, Boxes, Package,
  FileText, FileCode, ClipboardCheck, ListChecks,
  Search, MessageSquare, Bell, Mail,
  Cpu, Database, Cloud, Shield,
  Lock, Key, Rocket, FlaskConical,
  Microscope, BookOpen, Pencil, PenLine,
  Eye, BarChart3, Activity, Puzzle,
};

export { CUSTOM_STEP_ICON_NAMES };
