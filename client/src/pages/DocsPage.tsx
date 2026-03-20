import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  ArrowLeft,
  BookOpen,
  MessageSquare,
  FolderOpen,
  Wrench,
  Plug,
  Zap,
  Bot,
  Settings,
  Keyboard,
  Heart,
  Globe,
  Search,
  Brain,
  Workflow,
  Lightbulb,
  Mic,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useBranding } from '@/hooks/useBranding';

const SECTIONS = [
  { id: 'getting-started', label: 'Getting Started', icon: BookOpen },
  { id: 'chat', label: 'Chat & Conversations', icon: MessageSquare },
  { id: 'memory', label: 'Memory & Learning', icon: Brain },
  { id: 'workspace', label: 'Workspace', icon: FolderOpen },
  { id: 'tools', label: 'Tools & Capabilities', icon: Wrench },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'skills', label: 'Skills', icon: Lightbulb },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'subagents', label: 'Subagents', icon: Bot },
  { id: 'settings', label: 'Settings Reference', icon: Settings },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'heartbeat', label: 'Heartbeat', icon: Heart },
  { id: 'mcp', label: 'MCP Servers', icon: Globe },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'api', label: 'API Reference', icon: Zap },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function SectionGettingStarted() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Getting Started</h2>
      <p className="text-muted-foreground">
        {agentName} is your autonomous AI agent — a personal assistant that can manage your calendar, email,
        documents, research, and more. This guide covers everything you need to get up and running.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">First-Time Setup</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>When you first launch {agentName}, the setup wizard will walk you through:</p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li><strong>Create your account</strong> — Set up your admin username and password.</li>
            <li><strong>Configure an AI provider</strong> — Go to <em>Settings &gt; AI Providers</em> and add your API key (Anthropic, OpenAI, etc.).</li>
            <li><strong>Connect integrations</strong> — Link Google Workspace, Notion, Telegram, and other services in <em>Settings &gt; Integrations</em>.</li>
            <li><strong>Start chatting</strong> — Navigate to the Chat view and send your first message. {agentName} learns from every conversation.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Navigating the UI</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>The interface has three main areas:</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Navigation Rail</strong> (left edge, desktop/tablet) — Quick access to Chat, Workspace, and Settings.</li>
            <li><strong>Sidebar</strong> — Lists your conversations, templates, and projects. Accessible via the menu icon on mobile.</li>
            <li><strong>Main Content</strong> — The active chat, workspace browser, or settings page.</li>
          </ul>
          <p>On mobile, use the back arrow (top-left) to navigate between views, and the three-dot menu to access chats, workspace, and settings.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionChat() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Chat & Conversations</h2>
      <p className="text-muted-foreground">
        Chat is the primary way to interact with {agentName}. Each conversation is stored and searchable.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Starting a Conversation</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-2">
            <li>Click <strong>New</strong> in the sidebar header to start a fresh conversation.</li>
            <li>Type your message in the input bar at the bottom and press Enter or the send button.</li>
            <li>{agentName} will use the appropriate tools automatically — you don't need to specify which tool to use.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Templates</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Templates are pre-built conversation starters for common tasks. They appear in the sidebar under the Templates section.</p>
          <p>Admins can create and manage templates in <em>Settings &gt; Templates &amp; Projects</em>.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Projects</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Projects let you organize conversations into groups. Create a project from the sidebar, then assign chats to it.</p>
          <ul className="list-disc list-inside space-y-2">
            <li>Right-click (or use the menu) on any chat to <strong>Move to Project</strong>.</li>
            <li>Project chats are grouped under their project heading in the sidebar.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">File Uploads</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Attach files to your messages using the attachment button in the chat input. Supported formats include images, PDFs, and text documents.</p>
          <p>{agentName} can analyze uploaded files and use their content in the conversation.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Slash Commands</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Type a slash command as your entire message to trigger special behaviors:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><code className="text-xs bg-muted px-1 rounded">/usage</code> — Show live Claude Code subscription usage (session %, weekly %, weekly Sonnet %)</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Thor Mode</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Thor Mode is {agentName}'s maximum-power mode. When activated, it unlocks the highest reasoning capacity, max token output, and extended tool iterations for deep, complex work.</p>
          <p>Toggle it using the lightning bolt icon in the <strong>chat header</strong> (top-left of the chat, next to the model selector).</p>
          <p className="font-medium text-foreground mt-2">What Thor Mode changes:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>Thinking budget</strong> — Maxed to 32,000 tokens (vs. 4,000 standard)</li>
            <li><strong>Max output tokens</strong> — Full model limit (200K for Claude/GPT-5.4, 1M for Gemini)</li>
            <li><strong>Tool iterations</strong> — Up to 100 rounds (vs. 50 standard)</li>
            <li><strong>Temperature</strong> — Set to 1.0 for maximum creativity</li>
            <li><strong>Web search</strong> — Automatically uses Perplexity Sonar Deep Research</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Model Capabilities</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="mb-3">Each model has different capabilities. Models with native web search use their provider's built-in search; others fall back to Perplexity Sonar Pro.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/60 bg-muted/40">
                  <th className="px-2 py-2 text-left font-semibold">Model</th>
                  <th className="px-2 py-2 text-left font-semibold">Provider</th>
                  <th className="px-2 py-2 text-right font-semibold">Context</th>
                  <th className="px-2 py-2 text-center font-semibold">Tools</th>
                  <th className="px-2 py-2 text-center font-semibold">Vision</th>
                  <th className="px-2 py-2 text-center font-semibold">Thinking</th>
                  <th className="px-2 py-2 text-center font-semibold">Code</th>
                  <th className="px-2 py-2 text-left font-semibold">Web Search</th>
                  <th className="px-2 py-2 text-right font-semibold">Input $/1K</th>
                  <th className="px-2 py-2 text-right font-semibold">Output $/1K</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">Claude Opus 4.6</td>
                  <td className="px-2 py-1.5">Anthropic</td>
                  <td className="px-2 py-1.5 text-right">200K</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-blue-400">Native</td>
                  <td className="px-2 py-1.5 text-right">$0.015</td>
                  <td className="px-2 py-1.5 text-right">$0.075</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">Claude Sonnet 4.6</td>
                  <td className="px-2 py-1.5">Anthropic</td>
                  <td className="px-2 py-1.5 text-right">200K</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-blue-400">Native</td>
                  <td className="px-2 py-1.5 text-right">$0.003</td>
                  <td className="px-2 py-1.5 text-right">$0.015</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">Claude Haiku 4.5</td>
                  <td className="px-2 py-1.5">Anthropic</td>
                  <td className="px-2 py-1.5 text-right">200K</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-muted-foreground/50">None</td>
                  <td className="px-2 py-1.5 text-right">$0.0008</td>
                  <td className="px-2 py-1.5 text-right">$0.004</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">GPT-5.4</td>
                  <td className="px-2 py-1.5">OpenAI</td>
                  <td className="px-2 py-1.5 text-right">200K</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-blue-400">Native</td>
                  <td className="px-2 py-1.5 text-right">—</td>
                  <td className="px-2 py-1.5 text-right">—</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">Gemini 3.1 Pro</td>
                  <td className="px-2 py-1.5">Google</td>
                  <td className="px-2 py-1.5 text-right">1M</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-blue-400">Native</td>
                  <td className="px-2 py-1.5 text-right">$0.00125</td>
                  <td className="px-2 py-1.5 text-right">$0.005</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">Gemini 2.5 Flash</td>
                  <td className="px-2 py-1.5">Google</td>
                  <td className="px-2 py-1.5 text-right">1M</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-blue-400">Native</td>
                  <td className="px-2 py-1.5 text-right">$0.00015</td>
                  <td className="px-2 py-1.5 text-right">$0.0006</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">Titan-V</td>
                  <td className="px-2 py-1.5">Groq</td>
                  <td className="px-2 py-1.5 text-right">32K</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-blue-400">Native</td>
                  <td className="px-2 py-1.5 text-right">—</td>
                  <td className="px-2 py-1.5 text-right">—</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">GPT OS 120B</td>
                  <td className="px-2 py-1.5">Groq</td>
                  <td className="px-2 py-1.5 text-right">64K</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-amber-400">Perplexity</td>
                  <td className="px-2 py-1.5 text-right">—</td>
                  <td className="px-2 py-1.5 text-right">—</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">Qwen 3.5 397B</td>
                  <td className="px-2 py-1.5">Ollama</td>
                  <td className="px-2 py-1.5 text-right">64K</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-amber-400">Perplexity</td>
                  <td className="px-2 py-1.5 text-right">Free</td>
                  <td className="px-2 py-1.5 text-right">Free</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">Sonar Pro</td>
                  <td className="px-2 py-1.5">Perplexity</td>
                  <td className="px-2 py-1.5 text-right">8K</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-green-500">Built-in</td>
                  <td className="px-2 py-1.5 text-right">$0.003</td>
                  <td className="px-2 py-1.5 text-right">$0.015</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-foreground">Sonar Deep Research</td>
                  <td className="px-2 py-1.5">Perplexity</td>
                  <td className="px-2 py-1.5 text-right">4K</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-green-500">Built-in</td>
                  <td className="px-2 py-1.5 text-right">$0.005</td>
                  <td className="px-2 py-1.5 text-right">$0.005</td>
                </tr>
                <tr className="opacity-60">
                  <td className="px-2 py-1.5 font-medium text-foreground">Vega-3 <span className="text-xs font-normal text-muted-foreground/70 ml-1">legacy</span></td>
                  <td className="px-2 py-1.5">Groq</td>
                  <td className="px-2 py-1.5 text-right">32K</td>
                  <td className="px-2 py-1.5 text-center text-green-500">Yes</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground/50">No</td>
                  <td className="px-2 py-1.5 text-muted-foreground/50">None</td>
                  <td className="px-2 py-1.5 text-right">—</td>
                  <td className="px-2 py-1.5 text-right">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground/70 mt-3">
            <strong>Context</strong> = maximum input tokens. &nbsp;
            <strong>Tools</strong> = can use calendar, email, Drive, etc. &nbsp;
            <strong>Thinking</strong> = extended reasoning / Thor Mode support. &nbsp;
            <strong>Code</strong> = code execution support.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            <strong className="text-blue-400">Native</strong> = uses provider's built-in web search (no Perplexity cost). &nbsp;
            <strong className="text-amber-400">Perplexity</strong> = web search routed through Perplexity Sonar Pro. &nbsp;
            <strong className="text-green-500">Built-in</strong> = search is the core product.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            <strong>Native</strong> models: Claude Opus 4.6, Claude Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro, Gemini 2.5 Flash, Titan-V. &nbsp;
            All others fall back to Perplexity Sonar Pro.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Deep Research and Thor Mode always use Perplexity Sonar Deep Research regardless of model.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionMemory() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Memory & Learning</h2>
      <p className="text-muted-foreground">
        {agentName} learns from every conversation and builds a persistent memory that makes it smarter over time.
        This is what separates {agentName} from stateless AI assistants — it remembers your projects, preferences,
        workflows, and context across all future sessions.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Auto-Memory Extraction</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>After each conversation turn, {agentName} automatically extracts important facts, preferences, and procedures
          using a lightweight background process. This happens invisibly — you never need to tell {agentName} to remember something.</p>
          <p>Memories are categorized as:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>Fact</strong> — Your role, projects, key context about your situation</li>
            <li><strong>Preference</strong> — How you like things done, communication style, tool choices</li>
            <li><strong>Procedure</strong> — Established workflows, conventions, recurring task patterns</li>
            <li><strong>Context</strong> — Background knowledge important for future assistance</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Contextual Memory Injection</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>At the start of every conversation turn, {agentName} automatically loads two sets of memories:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>Top memories</strong> — The 10 highest-relevance memories are always present, so {agentName} always knows your most important context.</li>
            <li><strong>Contextual memories</strong> — Up to 5 additional memories are searched based on keywords in your current message, surfacing relevant details you may have discussed weeks ago.</li>
          </ul>
          <p>This means {agentName} walks into every conversation already knowing what matters — without you repeating yourself.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Deduplication</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Before saving a new memory, {agentName} checks existing memories for similarity using word-overlap analysis.
          If a new memory is more than 70% similar to an existing one, it is skipped. This prevents memory bloat
          and keeps the memory store clean and relevant.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Manual Memory</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>You can also explicitly tell {agentName} to remember or forget things:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><em>"Remember that I prefer bullet points over paragraphs"</em> — saves a preference memory</li>
            <li><em>"What do you remember about Project X?"</em> — searches stored memories</li>
          </ul>
          <p>{agentName} has dedicated <code className="text-xs bg-muted px-1 rounded">memory_save</code> and <code className="text-xs bg-muted px-1 rounded">memory_search</code> tools for this.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Memory Hygiene</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{agentName} automatically maintains memory quality:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Memories are capped at 500. When exceeded, the lowest-relevance memories are pruned automatically.</li>
            <li>Empty or failed responses do not trigger memory extraction.</li>
            <li>Heartbeat scans (automated checks) are excluded from memory extraction.</li>
          </ul>
          <p>You can review and manage all memories in <em>Settings &gt; Memory</em>.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionWorkspace() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Workspace</h2>
      <p className="text-muted-foreground">
        The Workspace is a file browser that stores artifacts created during your conversations. {agentName} automatically saves relevant outputs here.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Folder Structure</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="mb-3">Files are organized into folders by type:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border p-3">
              <p className="font-medium text-foreground">research/</p>
              <p className="text-xs">Deep research reports, web searches, fetched pages</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium text-foreground">email/</p>
              <p className="text-xs">Gmail search results and read emails</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium text-foreground">calendar/</p>
              <p className="text-xs">Calendar event listings</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium text-foreground">media/images/</p>
              <p className="text-xs">AI-generated images</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium text-foreground">media/videos/</p>
              <p className="text-xs">AI-generated videos</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium text-foreground">drive/</p>
              <p className="text-xs">Google Drive search results and document reads</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium text-foreground">notion/</p>
              <p className="text-xs">Notion search results and page reads</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium text-foreground">meetings/</p>
              <p className="text-xs">Meeting transcript searches and listings</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">What Gets Saved</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Read-only and retrieval tools automatically save their outputs. Action tools (sending emails, creating events, writing Notion pages) do <em>not</em> save to workspace since their effects live in the target service.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionTools() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Tools & Capabilities</h2>
      <p className="text-muted-foreground">
        {agentName} has access to a wide range of tools. They are invoked automatically based on your request.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Google Workspace</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="mb-2">Multiple Google accounts are supported (e.g. Work, Agency, Personal). All read tools fan out across all connected accounts and label results by account. Write tools accept an optional <code className="text-xs bg-muted px-1 rounded">account</code> parameter to target a specific one.</p>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Calendar</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><code className="text-xs bg-muted px-1 rounded">calendar_events</code> — List upcoming events across all accounts</li>
              <li><code className="text-xs bg-muted px-1 rounded">calendar_create_event</code> — Create new events (specify account if needed)</li>
              <li><code className="text-xs bg-muted px-1 rounded">calendar_update_event</code> / <code className="text-xs bg-muted px-1 rounded">calendar_delete_event</code> — Modify or remove events</li>
            </ul>
            <p className="font-medium text-foreground mt-3">Gmail</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><code className="text-xs bg-muted px-1 rounded">gmail_search</code> — Search emails across all connected accounts</li>
              <li><code className="text-xs bg-muted px-1 rounded">gmail_read</code> — Read full email content</li>
              <li><code className="text-xs bg-muted px-1 rounded">gmail_send</code> — Compose and send emails (specify account with <code className="text-xs bg-muted px-1 rounded">account</code> param)</li>
              <li><code className="text-xs bg-muted px-1 rounded">gmail_modify</code> — Archive, trash, label emails</li>
            </ul>
            <p className="font-medium text-foreground mt-3">Google Drive</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><code className="text-xs bg-muted px-1 rounded">drive_search</code> — Search files across all connected Drive accounts</li>
              <li><code className="text-xs bg-muted px-1 rounded">drive_read</code> — Read document content</li>
              <li><code className="text-xs bg-muted px-1 rounded">drive_write</code> — Create or update documents</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">GoHighLevel (CRM)</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="mb-2">Connect one or more GHL sub-accounts via MCP. Each account exposes 36+ tools covering contacts, opportunities, pipelines, calendars, conversations, workflows, invoices, and more.</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Default account</strong> — used automatically unless you specify otherwise.</li>
            <li><strong>Additional accounts</strong> — specify the account name in your message to route to a specific location.</li>
          </ul>
          <p className="mt-2">Always include the correct <code className="text-xs bg-muted px-1 rounded">locationId</code> for the account you're targeting. Configure accounts in <em>Settings &gt; MCP Servers</em>.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Notion</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li><code className="text-xs bg-muted px-1 rounded">notion_search</code> — Search pages and databases</li>
            <li><code className="text-xs bg-muted px-1 rounded">notion_read_page</code> — Read page content</li>
            <li><code className="text-xs bg-muted px-1 rounded">notion_create_page</code> / <code className="text-xs bg-muted px-1 rounded">notion_update_page</code> — Create and edit pages</li>
            <li><code className="text-xs bg-muted px-1 rounded">notion_query_database</code> — Query a Notion database with filters, sorts, and pagination</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Web & Research</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li><code className="text-xs bg-muted px-1 rounded">web_search</code> — Search the web for current information. Uses native provider search for Claude (Opus/Sonnet), GPT-5.4, Gemini (Pro/Flash), and Titan-V; falls back to Perplexity Sonar Pro for all other models. Deep Research and Thor Mode always use Sonar Deep Research.</li>
            <li><code className="text-xs bg-muted px-1 rounded">web_fetch</code> — Fetch and extract content from any URL</li>
            <li><code className="text-xs bg-muted px-1 rounded">deep_research</code> — Comprehensive multi-step research reports (Perplexity Sonar Deep Research)</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Media Generation</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li><code className="text-xs bg-muted px-1 rounded">image_generate</code> — Generate images using DALL-E or other configured providers</li>
            <li><code className="text-xs bg-muted px-1 rounded">video_generate</code> — Generate videos using Sora or Google Veo. <strong>One video at a time</strong> — if a generation is already in progress, new requests are queued until it completes (prevents duplicate videos).</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Code & Files</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li><code className="text-xs bg-muted px-1 rounded">python_execute</code> — Run Python code in a sandboxed WebAssembly environment. If the runtime fails to load (e.g. network issue), it auto-retries after 5 minutes — no restart needed.</li>
            <li><code className="text-xs bg-muted px-1 rounded">shell_execute</code> — Run shell commands in the workspace directory</li>
            <li><code className="text-xs bg-muted px-1 rounded">ssh_execute</code> — Execute commands on configured remote servers via SSH. Configure servers in <em>Settings &gt; Integrations</em>.</li>
            <li><code className="text-xs bg-muted px-1 rounded">file_read</code> — Read files from the workspace</li>
            <li><code className="text-xs bg-muted px-1 rounded">file_write</code> — Write files to the workspace</li>
            <li><code className="text-xs bg-muted px-1 rounded">file_edit</code> — Edit specific sections of workspace files</li>
            <li><code className="text-xs bg-muted px-1 rounded">claude_code</code> — Delegate complex coding tasks to a dedicated Claude Code container. Supports configurable model, effort level, and max turns. Sub-tool calls stream to the UI in real time.</li>
          </ul>
          <p className="mt-2">{agentName} has SSH access to your configured servers — just ask it to run a command on the remote server.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Autonomous & Background Tasks</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li><code className="text-xs bg-muted px-1 rounded">think</code> — Internal reasoning tool. {agentName} uses this to plan multi-step tasks, resolve ambiguity, or analyze tradeoffs before acting. Invoked automatically for complex decisions — output is not shown in chat.</li>
            <li><code className="text-xs bg-muted px-1 rounded">spawn_task</code> — Spawn a background task that runs independently of the current conversation. Useful for long-running operations.</li>
            <li><code className="text-xs bg-muted px-1 rounded">schedule_task</code> — Create a cron-scheduled task with a standard 5-field cron expression (e.g. <code className="text-xs bg-muted px-1 rounded">0 9 * * 1</code> for every Monday at 9am). Cron times are always interpreted in your profile timezone. One-shot or recurring.</li>
            <li><code className="text-xs bg-muted px-1 rounded">list_scheduled_tasks</code> — List all scheduled tasks with their next/last run times and enabled status.</li>
            <li><code className="text-xs bg-muted px-1 rounded">delete_scheduled_task</code> — Remove a scheduled task by ID.</li>
            <li><code className="text-xs bg-muted px-1 rounded">memory_save</code> / <code className="text-xs bg-muted px-1 rounded">memory_search</code> / <code className="text-xs bg-muted px-1 rounded">memory_delete</code> — Persist, retrieve, and remove information across conversations</li>
            <li><code className="text-xs bg-muted px-1 rounded">list_output_templates</code> — Look up configured output templates by name. Used automatically when you ask {agentName} to "use the [name] template" in a conversation.</li>
            <li><code className="text-xs bg-muted px-1 rounded">skill_update</code> — Create, update, or toggle skills from within a conversation. Enables self-improving behavior — {agentName} can codify learned patterns into persistent skills.</li>
            <li><code className="text-xs bg-muted px-1 rounded">propose_patch</code> — Propose code-level changes to the platform itself for review.</li>
            <li><code className="text-xs bg-muted px-1 rounded">gamma_create</code> — Create polished presentations and documents via Gamma AI.</li>
            <li><code className="text-xs bg-muted px-1 rounded">consolidate_data</code> — Aggregate and consolidate data from multiple tool results into a unified summary.</li>
          </ul>
          <p className="mt-2">Scheduled tasks survive server restarts and are managed from the <em>Workflows</em> page or Settings → Monitoring. When multiple tools are needed in a single turn, {agentName} executes them in parallel for faster results.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Meeting Transcripts (Recall AI)</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li><code className="text-xs bg-muted px-1 rounded">recall_search</code> — Search across meeting transcripts by keyword</li>
            <li><code className="text-xs bg-muted px-1 rounded">recall_meetings</code> — List recent recorded meetings with status</li>
            <li><code className="text-xs bg-muted px-1 rounded">recall_create_bot</code> — Send a bot to a specific meeting URL immediately or at a scheduled time</li>
          </ul>
          <p className="mt-2"><strong className="text-foreground">Auto-join:</strong> When Google Calendar is connected via Recall, {agentName} automatically joins every meeting that has a video link (Zoom, Google Meet, Teams, Webex) — 2 minutes before start. No manual intervention needed. Configure in <em>Settings &gt; Integrations &gt; Recall AI</em>.</p>
          <p className="mt-2">When a bot finishes (<code className="text-xs bg-muted px-1 rounded">bot.done</code>) {agentName} automatically fetches the transcript, generates an AI summary, and creates a Notion entry in your configured Meetings database. Fatal bot failures (<code className="text-xs bg-muted px-1 rounded">bot.fatal</code>) are logged to the Tool Error Log in System Monitor.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionVoice() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Voice</h2>
      <p className="text-muted-foreground">
        {agentName} supports voice input and output — speak your requests and hear responses read aloud.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Voice Input (Speech-to-Text)</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Press and hold the microphone button in the chat input bar to record a voice message. Release to send. {agentName} transcribes your speech and processes it like any text message.</p>
          <p className="font-medium text-foreground">Supported STT providers:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>Groq Whisper</strong> — Fast transcription via Groq API</li>
            <li><strong>OpenAI Whisper</strong> — OpenAI's speech-to-text model</li>
            <li><strong>Whisper Local</strong> — On-device transcription (no API call)</li>
          </ul>
          <p>Configure the STT provider in <em>Settings &gt; AI Providers</em>.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Voice Output (Text-to-Speech)</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>When voice mode is active, {agentName} reads its responses aloud. Playback controls (play/pause/stop) appear on each message.</p>
          <p className="font-medium text-foreground">Supported TTS providers:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>OpenAI TTS</strong> — High-quality text-to-speech (default model: gpt-4o-mini-tts, voice: alloy)</li>
            <li><strong>OpenAI Realtime</strong> — Low-latency WebSocket streaming for live conversation mode</li>
            <li><strong>ElevenLabs</strong> — Premium voice synthesis</li>
          </ul>
          <p>Configure voice model, voice name, and format in <em>Settings &gt; AI Providers</em> or via the <code className="text-xs bg-muted px-1 rounded">.env</code> file.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Conversation Mode</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Long-press the microphone button to enter <strong>Conversation Mode</strong> — a hands-free voice interaction where {agentName} listens continuously and responds with speech. Ideal for on-the-go use.</p>
          <p>When OpenAI Realtime is enabled (<code className="text-xs bg-muted px-1 rounded">OPENAI_VOICE_REALTIME_ENABLED=true</code>), conversation mode uses WebSocket streaming for near-instant voice responses.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionSkills() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Skills</h2>
      <p className="text-muted-foreground">
        Skills are higher-level behaviors that combine tools with context, guidelines, and prompting.
        Unlike tools (which are atomic on/off capabilities), a skill tells {agentName} <em>how</em> to approach
        a class of tasks — what to prioritize, what to avoid, and what patterns to follow.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Tools vs Skills</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p><strong>Tools</strong> are atomic capabilities — what {agentName} can do. Each tool can be individually enabled or disabled in <em>Settings &gt; Tools &gt; Agent Tools</em>.</p>
          <p><strong>Skills</strong> are composed behaviors — how {agentName} does it. A skill may reference one or many tools and adds context, guidelines, and prompt-injection to shape behavior reliably.</p>
          <p>Both are managed from separate settings pages: <em>Settings &gt; Tools</em> for tools, <em>Settings &gt; Skills</em> for skills.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Skill Types</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Prompt-Injection</strong> — The skill's instructions are injected directly into every {agentName} system prompt. Enables persistent behavioral patterns across all conversations.</li>
            <li><strong>Info</strong> — Display-only entry in the skills list. Used for documenting built-in tool groups without affecting the system prompt.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Built-in Anthropic Skills</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="mb-3">15 skills based on Anthropic's research into reliable agent behavior are pre-installed and enabled by default:</p>
          <div className="space-y-3">
            <div>
              <p className="font-medium text-foreground text-xs uppercase tracking-wide mb-1">Memory</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Memory Protocol</strong> — Always searches memory before responding; saves key facts after each task.</li>
                <li><strong>Contextual Retrieval</strong> — Uses semantic search to retrieve relevant context from past sessions.</li>
                <li><strong>Structured Note-taking</strong> — Saves multi-part task state as structured notes so work survives interruptions.</li>
                <li><strong>Reflect, Abstract & Generalize</strong> — After complex tasks, distills reusable patterns and saves them as procedures.</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground text-xs uppercase tracking-wide mb-1">Tool Use</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Think Before Acting</strong> — Uses the <code className="text-xs bg-muted px-1 rounded">think</code> tool to reason through complex multi-step decisions before executing.</li>
                <li><strong>Parallel Tool Calling</strong> — Runs independent tools simultaneously (e.g. calendar + email in a single turn) for faster results.</li>
                <li><strong>Tool Description Engineering</strong> — Ensures tools are used correctly by understanding when each tool is appropriate and when it isn't.</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground text-xs uppercase tracking-wide mb-1">Reliability</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Hallucination Prevention</strong> — Grounds every factual claim in verified tool results or memory; never invents data.</li>
                <li><strong>Pre-Response Verification</strong> — Checks response completeness against the original request before delivering.</li>
                <li><strong>Compaction Persistence</strong> — Saves progress state before context compression so long tasks resume correctly.</li>
                <li><strong>Action vs Research Mode</strong> — Classifies requests as ACTION (execute immediately) or RESEARCH (gather info first) to avoid premature changes.</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground text-xs uppercase tracking-wide mb-1">Orchestration</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Agentic Loop Control</strong> — Monitors its own loop depth; avoids runaway recursion.</li>
                <li><strong>Multi-Agent Orchestration</strong> — Delegates domain-specific subtasks to specialized subagents for complex workflows.</li>
                <li><strong>Evaluator-Optimizer Loop</strong> — After completing a task with an output template, evaluates the output against the template requirements and self-corrects if sections are missing.</li>
                <li><strong>Workflow Trigger</strong> — Teaches {agentName} to trigger scheduled workflows on-demand using <code className="text-xs bg-muted px-1 rounded">list_scheduled_tasks</code>.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Creating Custom Skills</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Go to <em>Settings &gt; Skills</em> and click <strong>Add Skill</strong>.</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Set <strong>Type</strong> to <em>Prompt-Injection</em> if you want to inject behavioral instructions into every session.</li>
            <li>Write your <strong>Instructions</strong> — be specific about when the skill applies and what {agentName} should do.</li>
            <li>Enable/disable skills without deleting them using the toggle.</li>
          </ul>
          <p>Custom skills are ideal for domain-specific procedures: "Always format client proposals with these sections…", "When discussing pricing, always check GHL first…"</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionWorkflows() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Workflows</h2>
      <p className="text-muted-foreground">
        The Workflows page shows your scheduled cron tasks with their step-by-step breakdowns, outputs,
        and run history. Access it from the main navigation.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">What Workflows Are</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Workflows are named recurring tasks that {agentName} runs on a schedule. Each workflow is backed by a cron job and includes:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>Steps</strong> — The individual actions {agentName} performs (check calendar, read email, update Notion, send brief, etc.)</li>
            <li><strong>Outputs</strong> — What the workflow produces (email, Notion page update, SMS, etc.)</li>
            <li><strong>Schedule</strong> — The cron expression shown in plain language (e.g. "Weekdays at 7:00 AM")</li>
            <li><strong>Last / Next Run</strong> — Run history shown in your profile timezone</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Run Now</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Every workflow card has a <strong>Run Now</strong> (▶) button. Clicking it triggers the workflow immediately as a one-off run — it does not change the next scheduled run time.</p>
          <p>Useful for testing your workflow config, re-running after a failure, or getting an on-demand brief outside of schedule.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Creating Workflows</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Workflows are created in two ways:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>Via chat</strong> — Tell {agentName}: <em>"Schedule a Morning Brief every weekday at 7 AM"</em>. {agentName} will use <code className="text-xs bg-muted px-1 rounded">schedule_task</code> to create the cron job and attach a prompt defining what to do each run.</li>
            <li><strong>Via Monitoring</strong> — Go to <em>Settings &gt; Monitoring &gt; Scheduled Tasks</em> for direct management of all cron jobs.</li>
          </ul>
          <p>All cron times are stored and executed in your profile timezone. The schedule is shown in plain language on the workflow card.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Managing Workflows</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li>Enable/disable individual workflows without deleting them.</li>
            <li>Delete a workflow from the Monitoring → Scheduled Tasks page.</li>
            <li>Ask {agentName}: <em>"List my scheduled tasks"</em> or <em>"Delete the Morning Brief workflow"</em>.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionSubagents() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Subagents</h2>
      <p className="text-muted-foreground">
        Subagents are specialized workers that {agentName} can delegate tasks to. They handle domain-specific work like coding, research, or sales outreach.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Prompt Subagents</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>A prompt subagent uses a custom system prompt to shape {agentName}'s behavior for a specific domain. When invoked, the subagent's prompt is injected into the conversation context.</p>
          <p>Create them in <em>Settings &gt; Subagent Library</em> by selecting type <strong>Prompt</strong> and providing the system prompt.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Webhook Subagents</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>A webhook subagent delegates work to an external workflow (e.g., an n8n webhook). {agentName} sends the user's request to the webhook URL and returns the response.</p>
          <p>Configure them with a <strong>Webhook URL</strong> and optional <strong>Workflow ID</strong> in the subagent library.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Output Templates</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Output Templates define structured formatting rules that {agentName} applies to its responses. Two ways to use them:</p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li><strong>Per-subagent</strong> — Assign a template when creating or editing a subagent in <em>Settings &gt; Subagent Library</em>. The template is automatically applied to every response from that subagent.</li>
            <li><strong>On-demand in conversation</strong> — Tell {agentName} <em>"use the morning brief template"</em> or <em>"format this as the daily email"</em>. {agentName} will look up the matching template and apply it automatically.</li>
          </ul>
          <p>Create and manage templates in <em>Settings &gt; {agentName} &gt; Output Templates</em>.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Managing Subagents</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-2">
            <li>Navigate to <em>Settings &gt; Subagent Library</em> to create, edit, or delete subagents.</li>
            <li>View the full directory at <em>/assistants</em> from the main app.</li>
            <li>Subagents can be activated or deactivated without deleting them.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionSettings() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Settings Reference</h2>
      <p className="text-muted-foreground">
        The Settings area is organized into groups. Access it from the NavRail (desktop) or the sidebar Settings button.
      </p>

      <Card>
        <CardContent className="text-sm pt-6">
          <div className="space-y-4">
            <div>
              <p className="font-semibold text-foreground">Setup</p>
              <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-1">
                <li><strong>Setup Wizard</strong> — Check system readiness and configure essential settings.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">{agentName}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-1">
                <li><strong>System Prompts</strong> — Define the default operating instructions for the agent.</li>
                <li><strong>Output Templates</strong> — Standardize structured responses and formatting blocks.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Subagents</p>
              <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-1">
                <li><strong>Subagent Library</strong> — Create and manage specialized subagents.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Knowledge</p>
              <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-1">
                <li><strong>Knowledge Base</strong> — Configure knowledge storage and upload permissions.</li>
                <li><strong>Memory</strong> — View, manage, and review auto-extracted memories. Memories are automatically deduplicated and pruned to stay under 500 entries.</li>
                <li><strong>Templates &amp; Projects</strong> — Create reusable templates and project workspaces.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Tools</p>
              <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-1">
                <li><strong>Agent Tools</strong> — Enable or disable individual tools. Tools are atomic capabilities — what the agent can do.</li>
                <li><strong>Tool Policies</strong> — Control access to tools and publish release notes.</li>
                <li><strong>MCP Servers</strong> — Connect external tool servers via the Model Context Protocol.</li>
                <li><strong>Trigger Rules</strong> — Map phrases to tools and skills for deterministic routing.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Skills</p>
              <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-1">
                <li><strong>Skills</strong> — Enable and configure agent skills. Skills compose tools with context and prompting to define reliable behaviors. 15 built-in Anthropic research skills are pre-installed; custom skills can be added.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Releases</p>
              <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-1">
                <li><strong>Release Management</strong> — Bundle system prompts, assistants, templates, output templates, and tool policies into versioned snapshots. Publish a release to activate it across all conversations, or roll back to a previous version instantly.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Advanced</p>
              <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-1">
                <li><strong>AI Providers</strong> — Configure LLM, TTS, STT, image, and video providers.</li>
                <li><strong>Integrations</strong> — Set up Google, Notion, Recall, and Telegram connections.</li>
                <li><strong>Heartbeat</strong> — Configure periodic autonomous scans.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Monitoring</p>
              <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-1">
                <li><strong>System Monitor</strong> — View system health, resource usage, active tasks, and operational status. Includes a <strong>Tool Error Log</strong> card showing all failed tool executions with tool name, timestamp, conversation ID, and full error detail (expandable). Errors are capped at 500 entries and can be cleared.</li>
                <li><strong>Scheduled Tasks</strong> — View, pause/resume, and delete cron jobs created via <code className="text-xs bg-muted px-1 rounded">schedule_task</code>. Shows next/last run times and cron expression for each job.</li>
              </ul>
              <p className="text-xs text-muted-foreground/70 mt-3">The system automatically cleans up expired sessions, old task records (30+ days),
              raw usage metrics (90+ days), and low-relevance memories on an hourly schedule.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionIntegrations() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Integrations</h2>
      <p className="text-muted-foreground">
        Connect external services to expand {agentName}'s capabilities. Configure all integrations in <em>Settings &gt; Integrations</em>.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Google Workspace</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Enables Calendar, Gmail, and Google Drive tools. Multiple Google accounts are supported — all read tools fan out across all connected accounts and label results by account.</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Go to <em>Settings &gt; Integrations &gt; Google</em> and enter your OAuth <strong>Client ID</strong> and <strong>Client Secret</strong>.</li>
            <li>Open your <strong>Profile</strong> (avatar in top-right) → <strong>Account</strong> tab → <strong>Connected Accounts</strong>.</li>
            <li>Click <strong>Connect</strong> next to Google and authorize access.</li>
          </ol>
          <p>Write tools (<code className="text-xs bg-muted px-1 rounded">gmail_send</code>, <code className="text-xs bg-muted px-1 rounded">calendar_create_event</code>, etc.) accept an optional <code className="text-xs bg-muted px-1 rounded">account</code> parameter to target a specific connected account.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">GoHighLevel (CRM)</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Connect one or more GHL sub-accounts via MCP. Each account exposes 36+ tools for contacts, opportunities, pipelines, calendars, conversations, workflows, and invoices.</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Default account</strong> — used automatically for all GHL requests.</li>
            <li><strong>Additional accounts</strong> — mention the account name in your request to route to a specific location.</li>
          </ul>
          <p>Each account is a separate MCP server with its own location credentials. Add and manage accounts in <em>Settings &gt; MCP Servers</em>.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Gamma (Presentations)</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{agentName} can create polished slide decks and documents via Gamma. Ask {agentName} to "create a presentation on X" and it will generate a Gamma deck with your content.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Notion</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Enables searching and reading Notion pages and databases.</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Go to <em>Settings &gt; Integrations</em>.</li>
            <li>Enter your Notion <strong>API Key</strong> (from Notion's integration settings).</li>
            <li>Ensure the integration has access to the pages you want {agentName} to search.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recall AI (Meeting Recording & Auto-join)</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{agentName} uses Recall AI to automatically record meetings, transcribe them, and save AI-generated summaries to Notion — all without any manual steps once configured.</p>

          <p className="font-medium text-foreground">Initial setup</p>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>Enter your <strong>Recall API Key</strong> in <em>Settings &gt; Integrations &gt; Recall AI</em>.</li>
            <li>Optionally set your <strong>region</strong> (default: <code className="text-xs bg-muted px-1 rounded">us-west-2</code>).</li>
            <li>Add your <strong>Notion Meetings Database ID</strong> so transcripts and summaries are automatically saved after each meeting.</li>
            <li>In the <a href="https://us-west-2.recall.ai/dashboard/webhooks" className="underline" target="_blank" rel="noopener noreferrer">Recall dashboard → Webhooks</a>, add a webhook pointing to <code className="text-xs bg-muted px-1 rounded">{`${window.location.origin}/api/webhooks/recall`}</code> with events <strong>bot.done</strong> and <strong>bot.fatal</strong>.</li>
          </ol>

          <p className="font-medium text-foreground">Automatic calendar-based joining</p>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>Make sure your Google account is connected in your profile (<em>Avatar → Account → Connected Accounts</em>).</li>
            <li>In <em>Settings &gt; Integrations &gt; Recall AI</em>, click <strong>Connect Google Calendar</strong>. This links your calendar to Recall with auto-join enabled — {agentName} will join every meeting with a video link (Zoom, Google Meet, Teams, Webex) 2 minutes before it starts.</li>
            <li>If your calendar was already connected before auto-join was added, click <strong>Enable auto-join</strong> on the connected calendar card to activate it.</li>
          </ol>

          <p className="font-medium text-foreground">What happens after a meeting</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Recall sends a <code className="text-xs bg-muted px-1 rounded">bot.done</code> webhook when the recording finishes.</li>
            <li>{agentName} fetches the transcript, generates an AI summary (speakers, key decisions, action items), and creates a Notion page in your Meetings database.</li>
            <li>Bot failures (<code className="text-xs bg-muted px-1 rounded">bot.fatal</code>) are logged to the Tool Error Log in System Monitor.</li>
          </ul>

          <p className="text-xs text-muted-foreground/70 mt-1">Transcripts may take up to 2 minutes after the meeting ends to become available. {agentName} polls automatically with retries.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Telegram</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Chat with {agentName} via Telegram for on-the-go access.</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Create a bot via <strong>@BotFather</strong> on Telegram.</li>
            <li>Enter the bot token in <em>Settings &gt; Integrations</em>.</li>
            <li>Specify authorized Telegram user IDs for security.</li>
          </ol>
          <p>{agentName} responds to messages via Telegram with full tool access (calendar, email, etc.).</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionHeartbeat() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Heartbeat</h2>
      <p className="text-muted-foreground">
        Heartbeat is {agentName}'s autonomous keepalive loop. Every tick it first continues any active work in progress, then runs your configured periodic scans — keeping {agentName} always-on without external triggers.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">How It Works</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Each heartbeat tick runs in two phases:</p>
          <ol className="list-decimal list-inside space-y-2">
            <li><strong>Phase 1 — Continue active work:</strong> If {agentName} has an in-progress task or open conversation, it resumes and advances that work first.</li>
            <li><strong>Phase 2 — Scheduled scans:</strong> After active work, {agentName} runs your configured checklist (upcoming meetings, unread emails, pending tasks, etc.) and delivers a summary.</li>
          </ol>
          <p>Every heartbeat response ends with a <code className="text-xs bg-muted px-1 rounded">NEXT TICK:</code> plan so {agentName} always knows where to pick up.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal list-inside space-y-2">
            <li>Go to <em>Settings &gt; Heartbeat</em> and enable the scheduler.</li>
            <li>Set the interval (e.g., every 15 or 30 minutes).</li>
            <li>Define scan items — what {agentName} should check each tick. Each item can be individually toggled on/off; only enabled items appear in the heartbeat output.</li>
            <li>Choose a delivery channel — <strong>In-App</strong> (Heartbeat conversation), <strong>Telegram</strong>, or <strong>SMS</strong> (via GoHighLevel MCP).</li>
            <li>The model used defaults to the platform default model. Override it per-heartbeat if needed.</li>
          </ol>
          <p className="mt-1 text-xs text-muted-foreground/70">
            <strong>SMS mode</strong> produces a compact single-line summary (under 160 chars) — e.g. "Working: 2 emails, 1 meeting" or "Heartbeat OK" — to fit SMS constraints. In-App and Telegram channels receive the full multi-section report.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Manual Trigger</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>You can trigger a heartbeat tick manually from the Heartbeat settings page using the <strong>Run Now</strong> button, or via <code className="text-xs bg-muted px-1 rounded">POST /api/admin/heartbeat/trigger</code>. Useful for testing your configuration.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionMcp() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">MCP Servers</h2>
      <p className="text-muted-foreground">
        The Model Context Protocol (MCP) lets you connect external tool servers to extend {agentName}'s capabilities beyond the built-in tools.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">What is MCP?</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>MCP is an open protocol for connecting AI assistants to external tools and data sources. Each MCP server exposes a set of tools that {agentName} can invoke during conversations.</p>
          <p>Examples: a database query tool, a CRM search tool, a custom API wrapper, or a specialized calculation engine.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Adding a Server</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal list-inside space-y-2">
            <li>Go to <em>Settings &gt; MCP Servers</em>.</li>
            <li>Click <strong>Add Server</strong> and enter the server URL and name.</li>
            <li>The server's tools will appear in {agentName}'s tool inventory automatically.</li>
            <li>Connection status is shown via the health indicator dots in the navigation rail.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Connected Servers</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Each MCP server you add appears here with its connection status and available tools. Example setup for GoHighLevel:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Default account</strong> — your primary GHL location (36+ tools)</li>
            <li><strong>Additional accounts</strong> — add one server per sub-account as needed</li>
          </ul>
          <p>Tools from each server are namespaced by server ID. {agentName} automatically routes to the correct account based on context.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionShortcuts() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Keyboard Shortcuts</h2>
      <p className="text-muted-foreground">
        Quick navigation shortcuts for the settings area. These work when no text input is focused.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Command Palette</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Open Command Palette</span>
            <div className="flex gap-1">
              <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">Ctrl</kbd>
              <span className="text-xs">+</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">K</kbd>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/70 mt-2">
            The Command Palette provides quick navigation to: New Chat, Chat, Workspace, Settings, AI Providers, MCP Servers, Skills, System Prompts, Memory, and Subagent Library. Start typing to filter.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Chat Input</CardTitle></CardHeader>
        <CardContent className="text-sm">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Send message</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">Enter</kbd>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">New line</span>
              <div className="flex gap-1">
                <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">Shift</kbd>
                <span className="text-xs">+</span>
                <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">Enter</kbd>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Slash commands</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">/</kbd>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionApi() {
  const { agentName } = useBranding();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">API Reference</h2>
      <p className="text-muted-foreground">
        {agentName} exposes a REST API for programmatic access. Below are key endpoint groups.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Authentication</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="space-y-1 font-mono text-xs">
            <p><span className="text-blue-500">GET</span> /api/auth/csrf-token <span className="font-sans text-muted-foreground/70">— get CSRF token (call before login to establish session)</span></p>
            <p><span className="text-green-500">POST</span> /api/auth/login <span className="font-sans text-muted-foreground/70">— requires X-CSRF-Token header</span></p>
            <p><span className="text-green-500">POST</span> /api/auth/logout</p>
            <p><span className="text-blue-500">GET</span> /api/auth/user</p>
            <p><span className="text-blue-500">GET</span> /api/auth/setup-status</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Chat</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="space-y-1 font-mono text-xs">
            <p><span className="text-blue-500">GET</span> /api/chats</p>
            <p><span className="text-green-500">POST</span> /api/chats</p>
            <p><span className="text-blue-500">GET</span> /api/chats/:id/messages</p>
            <p><span className="text-yellow-500">PATCH</span> /api/chats/:id/rename</p>
            <p><span className="text-yellow-500">PATCH</span> /api/chats/:id/move-to-project</p>
            <p><span className="text-red-500">DELETE</span> /api/chats/:id</p>
          </div>
          <p className="mt-3 font-semibold text-foreground text-xs">Streaming Completions (SSE)</p>
          <div className="space-y-1 font-mono text-xs mt-1">
            <p><span className="text-green-500">POST</span> /api/chat/completions/stream <span className="font-sans text-muted-foreground/70">— agent mode, Server-Sent Events</span></p>
            <p><span className="text-green-500">POST</span> /api/chat/completions <span className="font-sans text-muted-foreground/70">— single LLM call, non-streaming</span></p>
          </div>
          <p className="mt-2 text-xs">Stream events: <code className="bg-muted px-1 rounded">agent_status</code>, <code className="bg-muted px-1 rounded">thinking</code>, <code className="bg-muted px-1 rounded">text_delta</code>, <code className="bg-muted px-1 rounded">tool_call</code>, <code className="bg-muted px-1 rounded">tool_result</code>, <code className="bg-muted px-1 rounded">done</code>, <code className="bg-muted px-1 rounded">error</code></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Admin Settings</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="space-y-1 font-mono text-xs">
            <p><span className="text-blue-500">GET</span> /api/admin/settings</p>
            <p><span className="text-orange-500">PUT</span> /api/admin/settings</p>
            <p><span className="text-blue-500">GET</span> /api/admin/system-prompts</p>
            <p><span className="text-green-500">POST</span> /api/admin/system-prompts</p>
            <p><span className="text-blue-500">GET</span> /api/admin/templates</p>
            <p><span className="text-blue-500">GET</span> /api/admin/assistants</p>
            <p><span className="text-blue-500">GET</span> /api/admin/mcp/servers</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">User Preferences</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="space-y-1 font-mono text-xs">
            <p><span className="text-blue-500">GET</span> /api/user/preferences</p>
            <p><span className="text-orange-500">PUT</span> /api/user/preferences</p>
            <p><span className="text-blue-500">GET</span> /api/knowledge</p>
            <p><span className="text-green-500">POST</span> /api/knowledge</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Heartbeat &amp; Health</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="space-y-1 font-mono text-xs">
            <p><span className="text-blue-500">GET</span> /api/health/heartbeat</p>
            <p><span className="text-blue-500">GET</span> /api/admin/heartbeat/status</p>
            <p><span className="text-green-500">POST</span> /api/admin/heartbeat/trigger</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Scheduled Tasks (Cron Jobs)</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="space-y-1 font-mono text-xs">
            <p><span className="text-blue-500">GET</span> /api/cron-jobs</p>
            <p><span className="text-green-500">POST</span> /api/cron-jobs</p>
            <p><span className="text-yellow-500">PATCH</span> /api/cron-jobs/:id <span className="font-sans text-muted-foreground/70">— toggle enabled/paused</span></p>
            <p><span className="text-red-500">DELETE</span> /api/cron-jobs/:id</p>
          </div>
          <p className="mt-2">Cron jobs are DB-persisted and survive server restarts. Each job fires as an agent task at the scheduled time.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Agent Tasks</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="space-y-1 font-mono text-xs">
            <p><span className="text-blue-500">GET</span> /api/agent/tasks <span className="font-sans text-muted-foreground/70">— ?status=running|pending|completed|failed</span></p>
            <p><span className="text-blue-500">GET</span> /api/agent/tasks/:id</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Tool Error Log</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="space-y-1 font-mono text-xs">
            <p><span className="text-blue-500">GET</span> /api/admin/tool-errors <span className="font-sans text-muted-foreground/70">— ?limit=100 (max 500)</span></p>
            <p><span className="text-red-500">DELETE</span> /api/admin/tool-errors <span className="font-sans text-muted-foreground/70">— clear all errors</span></p>
          </div>
          <p className="mt-2">All failed tool executions are persisted here. Capped at 500 entries (oldest trimmed automatically).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Rate Limits</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="mb-2">In-memory rate limits apply per endpoint group (resets every 60 seconds):</p>
          <div className="space-y-1 text-xs font-mono">
            <p>/api/chat/completions <span className="font-sans text-muted-foreground/70">— 60 req/min</span></p>
            <p>/api/uploads <span className="font-sans text-muted-foreground/70">— 30 req/min</span></p>
            <p>/api/knowledge/* <span className="font-sans text-muted-foreground/70">— 20 req/min</span></p>
          </div>
          <p className="mt-2">Exceeding a limit returns <code className="text-xs bg-muted px-1 rounded">HTTP 429</code>. Limits reset server-side every 60 seconds. Designed to protect against runaway agent loops.</p>
        </CardContent>
      </Card>
    </div>
  );
}

const SECTION_COMPONENTS: Record<SectionId, () => JSX.Element> = {
  'getting-started': SectionGettingStarted,
  chat: SectionChat,
  memory: SectionMemory,
  workspace: SectionWorkspace,
  tools: SectionTools,
  voice: SectionVoice,
  skills: SectionSkills,
  workflows: SectionWorkflows,
  subagents: SectionSubagents,
  settings: SectionSettings,
  integrations: SectionIntegrations,
  heartbeat: SectionHeartbeat,
  mcp: SectionMcp,
  shortcuts: SectionShortcuts,
  api: SectionApi,
};

export default function DocsPage() {
  const { agentName } = useBranding();
  const [activeSection, setActiveSection] = useState<SectionId>('getting-started');
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSections = searchTerm.trim()
    ? SECTIONS.filter((s) => s.label.toLowerCase().includes(searchTerm.toLowerCase()))
    : SECTIONS;

  const ActiveComponent = SECTION_COMPONENTS[activeSection];

  return (
    <div className="flex h-dvh max-h-dvh w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border/60 bg-card/40">
        <div className="p-4 border-b border-border/40">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground hover:text-foreground mb-3 -ml-2"
            onClick={() => setLocation('/settings')}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Settings
          </Button>
          <h1 className="text-lg font-bold tracking-tight">Documentation</h1>
          <p className="text-xs text-muted-foreground mt-1">{agentName} User Guide</p>
        </div>

        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search docs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-background pl-9 pr-3 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <nav className="px-2 py-1 space-y-0.5">
            {filteredSections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                  activeSection === id
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </ScrollArea>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <div className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-border/40 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setLocation('/settings')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-bold">Docs</h1>
          <div className="ml-auto">
            <select
              value={activeSection}
              onChange={(e) => setActiveSection(e.target.value as SectionId)}
              className="rounded-lg border border-border/60 bg-background px-2 py-1 text-sm"
            >
              {SECTIONS.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
            <ActiveComponent />
          </div>
        </div>
      </div>
    </div>
  );
}
