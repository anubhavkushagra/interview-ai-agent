import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Video, Phone, MessageSquare, BarChart3, Loader2, Volume2, VolumeX, AlertTriangle } from 'lucide-react';

const InterviewPracticeApp = () => {
  const [sessionId] = useState(() => `session-${Date.now()}-${Math.random()}`);
  const [role, setRole] = useState('Software Engineer');
  const [persona, setPersona] = useState('Efficient User');
  const [experience, setExperience] = useState('Mid-level (3-5 years)');
  const [interviewStarted, setInterviewStarted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [interviewerSpeaking, setInterviewerSpeaking] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [offTopicWarnings, setOffTopicWarnings] = useState(0);
  const [showWarningBanner, setShowWarningBanner] = useState(false);

  const recognitionRef = useRef(null);
  const synthRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const videoRef = useRef(null);

  // Initialize speech recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event) => {
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          }
        }

        if (finalTranscript) {
          setCurrentMessage(prev => prev + finalTranscript);
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'no-speech' && isRecording) {
          setTimeout(() => {
            try { recognitionRef.current?.start(); } catch (e) {}
          }, 100);
        }
      };

      recognitionRef.current.onend = () => {
        if (isRecording && !isProcessing) {
          try { recognitionRef.current?.start(); } catch (e) {}
        }
      };
    }

    synthRef.current = window.speechSynthesis;

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (synthRef.current) synthRef.current.cancel();
    };
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Video animation effect
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.style.transform = interviewerSpeaking ? 'scale(1.02)' : 'scale(1)';
    }
  }, [interviewerSpeaking]);

  // Auto-hide warning banner after 5 seconds
  useEffect(() => {
    if (showWarningBanner) {
      const timer = setTimeout(() => setShowWarningBanner(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [showWarningBanner]);

  const speak = (text) => {
    if (!audioEnabled || !synthRef.current) return;

    synthRef.current.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setInterviewerSpeaking(true);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setInterviewerSpeaking(false);
    };

    synthRef.current.speak(utterance);
  };

  const startInterview = async () => {
    setInterviewStarted(true);
    setIsProcessing(true);

    try {
      const response = await fetch('http://localhost:5000/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, role, persona, experience, userMessage: 'Start the interview.' })
      });

      const data = await response.json();
      const botReply = data.reply || 'Hello! Let\'s begin the interview.';
      setTranscript([{ role: 'bot', text: botReply }]);
      speak(botReply);
    } catch (error) {
      console.error('Error starting interview:', error);
      alert('Failed to start interview. Please ensure the backend is running.');
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleRecording = () => {
    if (!isRecording) {
      setCurrentMessage('');
      try {
        recognitionRef.current?.start();
        setIsRecording(true);
      } catch (error) {
        console.error('Error starting recording:', error);
      }
    } else {
      recognitionRef.current?.stop();
      setIsRecording(false);
      if (currentMessage.trim()) {
        sendMessage(currentMessage.trim());
      }
    }
  };

  const sendMessage = async (message) => {
    if (!message.trim() || isProcessing) return;

    setIsProcessing(true);
    setTranscript(prev => [...prev, { role: 'user', text: message }]);
    setCurrentMessage('');
    setUserInput('');
    synthRef.current?.cancel();

    try {
      const response = await fetch('http://localhost:5000/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, role, persona, experience, userMessage: message })
      });

      const data = await response.json();
      
      // Handle off-topic warnings
      if (data.off_topic_warning) {
        setOffTopicWarnings(data.warning_count);
        setShowWarningBanner(true);
        
        // Add warning to transcript with special styling
        setTranscript(prev => [...prev, { 
          role: 'bot', 
          text: data.reply,
          isWarning: true 
        }]);
        
        setTimeout(() => speak(data.reply), 300);
      } else {
        const botReply = data.reply || 'I see. Let\'s continue.';
        setTranscript(prev => [...prev, { role: 'bot', text: botReply }]);
        setTimeout(() => speak(botReply), 300);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please check your connection.');
    } finally {
      setIsProcessing(false);
    }
  };

  const endInterview = async () => {
    setIsLoadingFeedback(true);
    setShowFeedback(true);
    recognitionRef.current?.stop();
    setIsRecording(false);
    synthRef.current?.cancel();

    try {
      const response = await fetch('http://localhost:5000/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });

      const data = await response.json();
      setFeedback(data.feedback || 'Thank you for participating!');
    } catch (error) {
      console.error('Error getting feedback:', error);
      setFeedback('Unable to generate feedback at this time.');
    } finally {
      setIsLoadingFeedback(false);
    }
  };

  const resetInterview = () => {
    fetch('http://localhost:5000/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });

    setInterviewStarted(false);
    setTranscript([]);
    setCurrentMessage('');
    setShowFeedback(false);
    setFeedback('');
    setOffTopicWarnings(0);
    setShowWarningBanner(false);
    recognitionRef.current?.stop();
    setIsRecording(false);
    synthRef.current?.cancel();
  };

  const handleTextSend = () => {
    if (userInput.trim()) {
      sendMessage(userInput.trim());
    }
  };

  if (showFeedback) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <div className="flex items-center gap-3 mb-6">
              <BarChart3 className="w-8 h-8 text-purple-400" />
              <h2 className="text-3xl font-bold text-white">Interview Feedback</h2>
            </div>

            {offTopicWarnings > 0 && (
              <div className="mb-6 p-4 bg-yellow-500/20 border border-yellow-500/40 rounded-lg">
                <p className="text-yellow-200 text-sm">
                  ⚠️ You received {offTopicWarnings} off-topic warning{offTopicWarnings > 1 ? 's' : ''} during this interview.
                </p>
              </div>
            )}

            {isLoadingFeedback ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-12 h-12 text-purple-400 animate-spin" />
                <span className="ml-4 text-white text-lg">Analyzing your performance...</span>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-white/5 rounded-lg p-6 border border-white/10">
                  <pre className="text-white whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {feedback}
                  </pre>
                </div>
                <button
                  onClick={resetInterview}
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold py-4 px-6 rounded-xl transition-all transform hover:scale-105 shadow-lg"
                >
                  Start New Interview
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!interviewStarted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6 flex items-center justify-center">
        <div className="max-w-2xl w-full">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <div className="text-center mb-8">
              <Video className="w-16 h-16 text-purple-400 mx-auto mb-4" />
              <h1 className="text-4xl font-bold text-white mb-2">AI Interview Coach</h1>
              <p className="text-purple-200">Prepare for your next opportunity with realistic mock interviews</p>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-white font-semibold mb-2">Interview Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="Software Engineer">Software Engineer</option>
                  <option value="Product Manager">Product Manager</option>
                  <option value="Sales Representative">Sales Representative</option>
                  <option value="Data Scientist">Data Scientist</option>
                  <option value="UX Designer">UX Designer</option>
                  <option value="Marketing Manager">Marketing Manager</option>
                  <option value="Retail Associate">Retail Associate</option>
                </select>
              </div>

              <div>
                <label className="block text-white font-semibold mb-2">Experience Level</label>
                <select
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="Entry-level (0-2 years)">Entry-level (0-2 years)</option>
                  <option value="Mid-level (3-5 years)">Mid-level (3-5 years)</option>
                  <option value="Senior (6-10 years)">Senior (6-10 years)</option>
                  <option value="Lead/Principal (10+ years)">Lead/Principal (10+ years)</option>
                </select>
              </div>

              <div>
                <label className="block text-white font-semibold mb-2">Your Interview Style (Persona)</label>
                <select
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="Efficient User">Efficient (concise, direct)</option>
                  <option value="Confused User">Confused (needs guidance)</option>
                  <option value="Chatty User">Chatty (conversational)</option>
                  <option value="Edge Case User">Edge Case (tests limits)</option>
                </select>
                <p className="text-purple-300 text-xs mt-2">
                  {persona === "Efficient User" && "✓ You provide clear, concise answers"}
                  {persona === "Confused User" && "? You often need clarification"}
                  {persona === "Chatty User" && "💬 You tend to give detailed, lengthy answers"}
                  {persona === "Edge Case User" && "⚠️ You test the interviewer's limits"}
                </p>
              </div>

              <button
                onClick={startInterview}
                disabled={isProcessing}
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold py-4 px-6 rounded-xl transition-all transform hover:scale-105 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Starting Interview...
                  </>
                ) : (
                  <>
                    <Video className="w-5 h-5" />
                    Start Mock Interview
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      {/* Off-Topic Warning Banner */}
      {showWarningBanner && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-2xl w-full px-4">
          <div className="bg-yellow-500/90 backdrop-blur-lg text-yellow-900 px-6 py-4 rounded-xl shadow-2xl border-2 border-yellow-600 flex items-center gap-3 animate-pulse">
            <AlertTriangle className="w-6 h-6 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-bold">Off-Topic Warning #{offTopicWarnings}</p>
              <p className="text-sm">Please stay focused on the interview question!</p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto h-[calc(100vh-2rem)] flex flex-col lg:flex-row gap-4">
        {/* Left Side - Video and Controls */}
        <div className="lg:w-2/3 flex flex-col gap-4">
          {/* Video Section */}
          <div
            ref={videoRef}
            className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-8 shadow-2xl border border-white/10 h-[350px] flex items-center justify-center relative overflow-hidden transition-transform duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-blue-500/10"></div>
            <div className={`relative z-10 text-center ${interviewerSpeaking ? 'animate-pulse' : ''}`}>
              <div className={`w-32 h-32 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-2xl ${interviewerSpeaking ? 'ring-4 ring-purple-400 ring-offset-4 ring-offset-slate-900' : ''}`}>
                <Video className="w-16 h-16 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">AI Interviewer</h3>
              <p className="text-purple-300">
                {interviewerSpeaking ? 'Speaking...' : isSpeaking ? 'Processing...' : 'Listening...'}
              </p>
              {interviewerSpeaking && (
                <div className="mt-4 flex justify-center gap-1">
                  <div className="w-2 h-8 bg-purple-400 rounded animate-pulse" style={{animationDelay: '0ms'}}></div>
                  <div className="w-2 h-12 bg-purple-400 rounded animate-pulse" style={{animationDelay: '150ms'}}></div>
                  <div className="w-2 h-6 bg-purple-400 rounded animate-pulse" style={{animationDelay: '300ms'}}></div>
                  <div className="w-2 h-10 bg-purple-400 rounded animate-pulse" style={{animationDelay: '450ms'}}></div>
                </div>
              )}
            </div>
          </div>

          {/* Controls Section */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-xl border border-white/20 flex-1">
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={toggleRecording}
                disabled={isProcessing || isSpeaking}
                className={`p-6 rounded-full transition-all transform hover:scale-110 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                  isRecording
                    ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                    : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700'
                }`}
              >
                {isRecording ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-white" />}
              </button>

              <button
                onClick={() => setAudioEnabled(!audioEnabled)}
                className="p-6 rounded-full bg-white/10 hover:bg-white/20 transition-all transform hover:scale-110 shadow-lg"
              >
                {audioEnabled ? <Volume2 className="w-8 h-8 text-white" /> : <VolumeX className="w-8 h-8 text-white" />}
              </button>

              <button
                onClick={endInterview}
                disabled={isProcessing}
                className="p-6 rounded-full bg-red-500 hover:bg-red-600 transition-all transform hover:scale-110 shadow-lg disabled:opacity-50"
              >
                <Phone className="w-8 h-8 text-white" />
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {isRecording && currentMessage && (
                <div className="bg-purple-500/20 rounded-lg p-3 border border-purple-500/30">
                  <p className="text-white text-sm">
                    <span className="font-semibold">You're saying:</span> {currentMessage}
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleTextSend()}
                  placeholder="Or type your response here..."
                  disabled={isProcessing || isSpeaking}
                  className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                />
                <button
                  onClick={handleTextSend}
                  disabled={isProcessing || isSpeaking || !userInput.trim()}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-6 py-3 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <MessageSquare className="w-5 h-5" />
                </button>
              </div>
            </div>

            <p className="text-center text-purple-300 text-sm mt-4">
              {isRecording ? '🎤 Recording... Click mic again when done' : '💡 Click mic to speak or type your answer'}
            </p>

            <div className="mt-4 pt-4 border-t border-white/20">
              <div className="flex justify-between items-center text-sm text-purple-300">
                <div>
                  <p><strong>Role:</strong> {role}</p>
                  <p><strong>Level:</strong> {experience}</p>
                  <p><strong>Persona:</strong> {persona}</p>
                </div>
                {offTopicWarnings > 0 && (
                  <div className="bg-yellow-500/20 px-3 py-2 rounded-lg border border-yellow-500/40">
                    <p className="text-yellow-300 font-semibold">⚠️ {offTopicWarnings} Warning{offTopicWarnings > 1 ? 's' : ''}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Side - Transcript */}
        <div className="lg:w-1/3 bg-white/10 backdrop-blur-lg rounded-2xl shadow-xl border border-white/20 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 p-6 border-b border-white/20">
            <MessageSquare className="w-6 h-6 text-purple-400" />
            <h3 className="text-xl font-bold text-white">Interview Transcript</h3>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {transcript.map((msg, idx) => (
              <div key={idx} className={msg.role === 'bot' ? 'text-left' : 'text-right'}>
                <div
                  className={`inline-block max-w-[85%] p-4 rounded-2xl ${
                    msg.isWarning
                      ? 'bg-yellow-500/30 border-2 border-yellow-500/60'
                      : msg.role === 'bot'
                      ? 'bg-gradient-to-r from-purple-600/30 to-blue-600/30 border border-purple-500/30'
                      : 'bg-white/20 border border-white/20'
                  }`}
                >
                  <p className="text-xs font-semibold text-purple-300 mb-1 flex items-center gap-1">
                    {msg.isWarning && <AlertTriangle className="w-3 h-3" />}
                    {msg.role === 'bot' ? 'Interviewer' : 'You'}
                    {msg.isWarning && ' (Warning)'}
                  </p>
                  <p className="text-white text-sm leading-relaxed">{msg.text}</p>
                </div>
              </div>
            ))}

            {isProcessing && (
              <div className="text-left">
                <div className="inline-block bg-gradient-to-r from-purple-600/30 to-blue-600/30 border border-purple-500/30 p-4 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                    <p className="text-white text-sm">Interviewer is thinking...</p>
                  </div>
                </div>
              </div>
            )}

            <div ref={transcriptEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterviewPracticeApp;