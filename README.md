# Echo - The AI Executive Assistant

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2016.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9%2B-blue)](https://www.typescriptlang.org/)

> A command-line AI assistant for orchestrating local file and email tasks using the Model Context Protocol (MCP)

## 🎯 Overview

Echo is a unified, intelligent assistant that understands complex, multi-step commands in natural language and executes them by orchestrating actions across specialized services. It demonstrates advanced MCP concepts including RAG (Retrieval-Augmented Generation), server-side sampling, and multi-service workflows.

**Target Users**: Technical users (developers, product managers) comfortable with the command line who want to automate and streamline daily productivity workflows.

## ✨ Key Features

### 🔗 Multi-Service Orchestration
- **What it does**: Execute complex commands that span both local files and Gmail
- **Example**: `"Find the latest email from 'news@example.com' and save it to newsletter.txt"`
- **How it works**: Connects to both Filesystem and Gmail servers, chains multiple tool calls seamlessly

### 🧠 RAG-Powered Email Drafting
- **What it does**: Generate context-aware, personalized email drafts
- **Example**: `"Draft a reply to the latest email from Jane Doe saying I'll review the document this afternoon"`
- **How it works**: Retrieves email context, uses prompt templates with LLM augmentation, saves drafts to Gmail

### 🎯 AI-Powered Quality Assurance
- **What it does**: Automatically check AI-generated content for professionalism and tone
- **Example**: Validates email drafts before saving them
- **How it works**: Uses server-side sampling to evaluate text quality and provides feedback

## 🏗️ Architecture

Echo consists of three independent processes communicating via stdio:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Echo Client   │    │ Filesystem      │    │ Gmail Server    │
│  (Orchestrator) │◄──►│ Server          │    │                 │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   OpenAI API    │    │  Local Files    │    │  Google API     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Components

#### 📁 Filesystem Server (`filesystem-server.js`)
- **Transport**: StdioServerTransport
- **Responsibilities**: Manages file operations within a sandboxed root directory
- **Tools**: `read_file`, `write_file`, `list_directory`
- **Status**: ✅ Complete

#### ✉️ Gmail Server (`gmail-server.js`)
- **Transport**: StdioServerTransport
- **Responsibilities**: Manages Gmail API interactions and OAuth 2.0 token management
- **Tools**: `list_emails`, `create_draft`, `quality_check`
- **Status**: 🔄 In Progress (adding quality_check tool)

#### 🤖 Echo Orchestrator (`echo-orchestrator.ts`)
- **Responsibilities**: 
  - Primary user-facing application
  - Spawns and manages server processes
  - Connects to servers via stdio streams
  - Merges toolsets from multiple servers
  - Uses OpenAI to interpret commands and generate execution plans
  - Executes multi-step workflows with tool chaining
  - Manages RAG and Quality Assurance workflows
- **Status**: 🚧 To be built

## 🔧 Installation & Setup

### Prerequisites
- Node.js 16.0.0 or higher
- npm or yarn package manager
- Google Cloud Console project with Gmail API enabled
- OpenAI API key

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/echo-ai-assistant.git
cd echo-ai-assistant
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your API keys
```

4. **Configure Google OAuth**
- Create credentials in Google Cloud Console
- Download `credentials.json` to the project root
- Run the OAuth flow: `npm run setup-gmail`

### Environment Variables
```env
OPENAI_API_KEY=your_openai_api_key_here
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SANDBOX_ROOT=/path/to/your/sandbox/directory
```

## 🚀 Usage

### Basic Commands

```bash
# Start Echo
npm start

# Example commands you can try:
echo> "List all files in my documents folder"
echo> "Find emails from john@company.com from last week"
echo> "Draft a reply to the latest email from Sarah saying I'll join the meeting"
echo> "Save the latest newsletter to my reading list folder"
```

### Advanced Workflows

```bash
# Multi-service orchestration
echo> "Find the contract email from legal@company.com and save the attachment to contracts/new-deal.pdf"

# RAG-powered drafting
echo> "Draft a professional follow-up email to the client meeting thread, mentioning the key points discussed"

# Quality-assured communication
echo> "Draft a response to the complaint email, ensuring it's professional and empathetic"
```

## 📊 Development Status

| Feature | Status | Description |
|---------|--------|-------------|
| Filesystem Server | ✅ Complete | File operations with sandboxing |
| Gmail Server | 🔄 In Progress | Email management + quality check |
| Echo Orchestrator | 🚧 To be built | Main orchestration logic |
| Multi-Service Orchestration | ⏳ Planned | Cross-service workflows |
| RAG Email Drafting | ⏳ Planned | Context-aware email generation |
| Quality Assurance | ⏳ Planned | AI-powered content validation |

## 🛠️ Technical Implementation

### MCP Concepts Demonstrated
- **Multi-server connections**: Connecting to multiple MCP servers simultaneously
- **Workflow chaining**: Linking outputs from one tool to inputs of another
- **RAG implementation**: Using retrieved context to augment LLM prompts
- **Server-side sampling**: LLM calls within MCP server implementations
- **Prompt templates**: Structured prompt engineering for consistent results

### Project Structure
```
echo-ai-assistant/
├── src/
│   ├── servers/
│   │   ├── filesystem-server.js     # ✅ Complete
│   │   └── gmail-server.js          # 🔄 In Progress
│   ├── orchestrator/
│   │   └── echo-orchestrator.ts     # 🚧 To be built
│   └── utils/
├── tests/
├── docs/
└── README.md
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
```bash
# Clone and install
git clone https://github.com/yourusername/echo-ai-assistant.git
cd echo-ai-assistant
npm install

# Run tests
npm test

# Run in development mode
npm run dev
```

**Note**: This project is currently in active development. The Filesystem Server is complete, the Gmail Server is being enhanced with quality checking capabilities, and the main Echo Orchestrator is being built. Stay tuned for updates!
