# Quick Setup Guide

## Prerequisites
- Node.js 18 or higher
- Google Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))
- Modern browser (Chrome/Edge recommended for best voice support)

## Installation Steps

### 1. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in the `backend` directory:

```env
GEMINI_API_KEY=your_api_key_here
PORT=5000
```

### 2. Frontend Setup

```bash
cd ../frontend
npm install
```

### 3. Running the Application

**Terminal 1 - Backend:**
```bash
cd backend
npm start
# Server will run on http://localhost:5000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# App will run on http://localhost:5173 (or shown port)
```

### 4. Access the Application

1. Open your browser to the frontend URL (usually `http://localhost:5173`)
2. Allow microphone permissions when prompted
3. Select your interview role, experience level, and persona
4. Click "Start Mock Interview"
5. Speak naturally - your speech will auto-send after 2.5 seconds of silence
6. Type responses if voice isn't working
7. Say "end interview" or click the phone icon to finish and get feedback

## Troubleshooting

### Backend won't start
- Check that `.env` file exists in `backend/` directory
- Verify `GEMINI_API_KEY` is set correctly
- Ensure port 5000 is not already in use

### Frontend can't connect to backend
- Verify backend is running on port 5000
- Check browser console for CORS errors
- Ensure both servers are running

### Voice not working
- Use Chrome or Edge browser
- Check microphone permissions in browser settings
- Try refreshing the page and allowing permissions again
- Use text input as fallback

### API errors
- Verify your Gemini API key is valid
- Check API quota/limits in Google Cloud Console
- Review backend console for detailed error messages

## Testing Different Personas

1. **Efficient User**: Select "Efficient" persona - agent will be direct and concise
2. **Confused User**: Select "Confused" persona - agent will provide more guidance
3. **Chatty User**: Select "Chatty" persona - agent will allow tangents but redirect
4. **Edge Case User**: Select "Edge Case" persona - try going off-topic or giving unclear answers

## Demo Scenarios

See the main README.md for detailed demo scenarios showing how the agent handles different user types.


