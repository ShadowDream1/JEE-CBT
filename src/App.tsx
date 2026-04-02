import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { Upload, FileText, Settings, Play, CheckCircle, Circle, ArrowRight, ArrowLeft, Bookmark, Info, User, Moon, Sun } from 'lucide-react';
import clsx from 'clsx';
import { GoogleGenAI, Type } from '@google/genai';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type QuestionType = 'SINGLE_CORRECT' | 'MULTIPLE_CORRECT' | 'NUMERICAL' | 'MATRIX_MATCH';

interface BoundingBox {
  page: number;
  ymin: number;
  ymax: number;
}

interface QuestionData {
  id: string;
  questionNumber: number;
  subject: string;
  section: string;
  boxes: BoundingBox[];
  answer: string;
  type: QuestionType;
}

type QuestionStatus = 'NOT_VISITED' | 'NOT_ANSWERED' | 'ANSWERED' | 'MARKED_FOR_REVIEW' | 'ANSWERED_AND_MARKED';

interface UserResponse {
  answer: string;
  status: QuestionStatus;
  timeSpent: number;
}

export default function App() {
  const [step, setStep] = useState<'SETUP' | 'TEST' | 'RESULT' | 'HISTORY'>('SETUP');
  const [testType, setTestType] = useState<'MAIN' | 'ADVANCED'>('MAIN');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [testHistory, setTestHistory] = useState<any[]>([]);
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKeyPrompt, setShowApiKeyPrompt] = useState(false);
  const [showPalette, setShowPalette] = useState(true);
  const [isDark, setIsDark] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const history = localStorage.getItem('jee_test_history');
    if (history) {
      try {
        setTestHistory(JSON.parse(history));
      } catch (e) { }
    }

    const savedApiKey = localStorage.getItem('gemini_api_key');
    if (savedApiKey) {
      setApiKey(savedApiKey);
    } else if (!(import.meta as any).env.VITE_GEMINI_API_KEY && !process.env.GEMINI_API_KEY) {
      setShowApiKeyPrompt(true);
    }

    const savedTheme = localStorage.getItem('theme_mode');
    if (savedTheme === 'dark') setIsDark(true);
  }, []);

  useEffect(() => {
    localStorage.setItem('theme_mode', isDark ? 'dark' : 'light');
  }, [isDark]);

  const processPdf = async () => {
    if (!pdfFile) return;
    setIsProcessing(true);
    setProcessingProgress(10);

    try {
      const fileReader = new FileReader();
      fileReader.onload = async function () {
        try {
          setProcessingProgress(30);
          const base64Data = (this.result as string).split(',')[1];
          
          const ai = new GoogleGenAI({ apiKey: apiKey || (import.meta as any).env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY });
          
          setProcessingProgress(50);
          const prompt = `Analyze this JEE Mock Test PDF. 
          First, look at the first few pages for any General Instructions or Marking Scheme. Use this to understand the structure if available.
          Extract the correct answer for every question from the answer key at the end. 
          Then, go through the PDF page by page. For every question, determine the exact bounding boxes (page, ymin, ymax) that contain the question text, options, and any associated comprehension paragraph or diagrams. If a question spans multiple pages or has a separate comprehension paragraph, include multiple boxes in the 'boxes' array. Make sure the cropping is tight but do not cut off any text. Add a small padding to ymin and ymax to ensure the entire question and options are fully visible. EVERY question MUST have at least one box in the 'boxes' array.
          Use a normalized coordinate system from 0 to 1000 (where 0 is the top of the page and 1000 is the bottom).
          Identify the subject (Physics, Chemistry, Mathematics).
          Identify the section name exactly as written in the PDF (e.g., "SECTION-I (i)", "SECTION-II").
          Identify the question type: 'SINGLE_CORRECT' (one option correct), 'MULTIPLE_CORRECT' (one or more options correct), 'NUMERICAL' (integer or decimal value), or 'MATRIX_MATCH' (matching lists).
          Output a JSON array of objects.
          Extract ALL questions from the PDF (typically 50 to 90 questions for a full JEE paper). Do not limit the output.`;

          const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite-preview',
            contents: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType: 'application/pdf'
                }
              },
              prompt
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    questionNumber: { type: Type.INTEGER },
                    subject: { type: Type.STRING },
                    section: { type: Type.STRING },
                    boxes: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          page: { type: Type.INTEGER },
                          ymin: { type: Type.INTEGER },
                          ymax: { type: Type.INTEGER }
                        },
                        required: ["page", "ymin", "ymax"]
                      }
                    },
                    answer: { type: Type.STRING },
                    type: { type: Type.STRING }
                  },
                  required: ["questionNumber", "subject", "section", "boxes", "answer", "type"]
                }
              }
            }
          });

          setProcessingProgress(80);
          const jsonStr = response.text;
          if (!jsonStr) {
            throw new Error('Failed to parse PDF');
          }
          const questions = JSON.parse(jsonStr);

          if (questions && questions.length > 0) {
            // Sort by page and ymin to ensure PDF order
            const sorted = questions.sort((a: any, b: any) => {
              const boxA = a.boxes && a.boxes[0] ? a.boxes[0] : { page: 0, ymin: 0 };
              const boxB = b.boxes && b.boxes[0] ? b.boxes[0] : { page: 0, ymin: 0 };
              if (boxA.page !== boxB.page) return boxA.page - boxB.page;
              return boxA.ymin - boxB.ymin;
            });

            // Add unique ID and continuous question number
            const withIds = sorted.map((q: any, index: number) => ({
              ...q,
              questionNumber: index + 1,
              id: `q-${index + 1}`
            }));

            setQuestions(withIds);
            setCurrentSubject(withIds[0].subject);

            // Initialize responses
            const initialResponses: Record<string, UserResponse> = {};
            withIds.forEach((q: any) => {
              initialResponses[q.id] = { answer: '', status: 'NOT_VISITED', timeSpent: 0 };
            });
            initialResponses[withIds[0].id].status = 'NOT_ANSWERED';
            setResponses(initialResponses);

            setProcessingProgress(100);
            setIsReady(true);
          } else {
            alert("Could not extract any questions from the PDF.");
          }
        } catch (err: any) {
          console.error(err);
          alert(`Error processing PDF: ${err.message || 'Please try again.'}`);
        } finally {
          setIsProcessing(false);
          setProcessingProgress(0);
        }
      };
      fileReader.readAsArrayBuffer(pdfFile);
    } catch (err: any) {
      console.error(err);
      alert(`Error processing PDF: ${err.message || 'Please try again.'}`);
      setIsProcessing(false);
      setProcessingProgress(0);
    }
  };

  const startTest = () => {
    setStep('TEST');
  };

  // Test State
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [responses, setResponses] = useState<Record<string, UserResponse>>({});
  const [timeLeft, setTimeLeft] = useState(180 * 60); // 3 hours
  const [currentSubject, setCurrentSubject] = useState<string>('');
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Load PDF when file is selected
  useEffect(() => {
    if (pdfFile) {
      const fileReader = new FileReader();
      fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result as ArrayBuffer);
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        setPdfDoc(pdf);
      };
      fileReader.readAsArrayBuffer(pdfFile);
    }
  }, [pdfFile]);

  // Timer
  useEffect(() => {
    if (step === 'TEST' && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            submitTest();
            return 0;
          }
          return prev - 1;
        });

        // Update time spent on current question
        if (questions.length > 0) {
          const currentQ = questions[currentQuestionIndex];
          if (currentQ) {
            setResponses(prev => ({
              ...prev,
              [currentQ.id]: {
                ...prev[currentQ.id],
                timeSpent: (prev[currentQ.id]?.timeSpent || 0) + 1
              }
            }));
          }
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [step, currentQuestionIndex, questions]);

  // Render current question image
  useEffect(() => {
    if (step === 'TEST' && pdfDoc && questions.length > 0) {
      renderQuestionImage();
    }
  }, [currentQuestionIndex, step, pdfDoc, questions]);

  const renderQuestionImage = async () => {
    if (!pdfDoc || !canvasContainerRef.current || questions.length === 0) return;

    const q = questions[currentQuestionIndex];
    if (!q) return;

    const container = canvasContainerRef.current;
    container.innerHTML = ''; // clear previous canvases

    try {
      if (!q.boxes || q.boxes.length === 0) {
        container.innerHTML = '<div class="p-4 text-red-500">Error: No bounding box found for this question.</div>';
        return;
      }
      for (const box of q.boxes) {
        const page = await pdfDoc.getPage(box.page);
        const viewport = page.getViewport({ scale: 2.0 });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;

        const targetCanvas = document.createElement('canvas');
        targetCanvas.className = "max-w-full h-auto mx-auto mb-4";
        targetCanvas.style.width = '100%';
        const targetCtx = targetCanvas.getContext('2d');
        if (!targetCtx) continue;

        const yStart = (box.ymin / 1000) * canvas.height;
        const yEnd = (box.ymax / 1000) * canvas.height;
        const cropHeight = yEnd - yStart;

        targetCanvas.width = canvas.width;
        targetCanvas.height = cropHeight;

        targetCtx.drawImage(
          canvas,
          0, yStart, canvas.width, cropHeight,
          0, 0, targetCanvas.width, cropHeight
        );

        container.appendChild(targetCanvas);
      }
    } catch (err) {
      console.error("Error rendering question:", err);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPdfFile(e.target.files[0]);
      setIsReady(false);
    }
  };

  const startDemoTest = () => {
    const demoQuestions: QuestionData[] = [
      { id: "demo-1", questionNumber: 1, subject: "Physics", section: "SECTION-I (i)", boxes: [{ page: 1, ymin: 200, ymax: 450 }], answer: "A", type: "SINGLE_CORRECT" },
      { id: "demo-2", questionNumber: 2, subject: "Physics", section: "SECTION-I (i)", boxes: [{ page: 1, ymin: 450, ymax: 650 }], answer: "B", type: "SINGLE_CORRECT" },
      { id: "demo-3", questionNumber: 3, subject: "Physics", section: "SECTION-I (ii)", boxes: [{ page: 1, ymin: 650, ymax: 950 }], answer: "A,B,C", type: "MULTIPLE_CORRECT" },
      { id: "demo-4", questionNumber: 4, subject: "Chemistry", section: "SECTION-I (i)", boxes: [{ page: 2, ymin: 100, ymax: 400 }], answer: "D", type: "SINGLE_CORRECT" },
      { id: "demo-5", questionNumber: 5, subject: "Chemistry", section: "SECTION-I (ii)", boxes: [{ page: 2, ymin: 400, ymax: 700 }], answer: "A,C", type: "MULTIPLE_CORRECT" },
      { id: "demo-6", questionNumber: 6, subject: "Mathematics", section: "SECTION-I (i)", boxes: [{ page: 3, ymin: 100, ymax: 500 }], answer: "B", type: "SINGLE_CORRECT" },
      { id: "demo-7", questionNumber: 7, subject: "Mathematics", section: "SECTION-II", boxes: [{ page: 3, ymin: 500, ymax: 900 }], answer: "42.50", type: "NUMERICAL" },
    ];

    setQuestions(demoQuestions);
    setCurrentSubject(demoQuestions[0].subject);

    const initialResponses: Record<string, UserResponse> = {};
    demoQuestions.forEach((q) => {
      initialResponses[q.id] = { answer: '', status: 'NOT_VISITED', timeSpent: 0 };
    });
    initialResponses[demoQuestions[0].id].status = 'NOT_ANSWERED';
    setResponses(initialResponses);

    setStep('TEST');
  };

  const handleAnswerChange = (val: string) => {
    const q = questions[currentQuestionIndex];
    setResponses(prev => ({
      ...prev,
      [q.id]: { ...prev[q.id], answer: val }
    }));
  };

  const saveAndNext = () => {
    const q = questions[currentQuestionIndex];
    const currentRes = responses[q.id];

    setResponses(prev => ({
      ...prev,
      [q.id]: {
        ...currentRes,
        status: currentRes.answer ? 'ANSWERED' : 'NOT_ANSWERED'
      }
    }));

    goToNextQuestion();
  };

  const markForReviewAndNext = () => {
    const q = questions[currentQuestionIndex];
    const currentRes = responses[q.id];

    setResponses(prev => ({
      ...prev,
      [q.id]: {
        ...currentRes,
        status: currentRes.answer ? 'ANSWERED_AND_MARKED' : 'MARKED_FOR_REVIEW'
      }
    }));

    goToNextQuestion();
  };

  const clearResponse = () => {
    const q = questions[currentQuestionIndex];
    setResponses(prev => ({
      ...prev,
      [q.id]: { answer: '', status: 'NOT_ANSWERED' }
    }));
  };

  const goToNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      const nextQ = questions[currentQuestionIndex + 1];
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setCurrentSubject(nextQ.subject);

      if (responses[nextQ.id].status === 'NOT_VISITED') {
        setResponses(prev => ({
          ...prev,
          [nextQ.id]: { ...prev[nextQ.id], status: 'NOT_ANSWERED' }
        }));
      }
    }
  };

  const jumpToQuestion = (index: number) => {
    const q = questions[currentQuestionIndex];
    const currentRes = responses[q.id];

    // Save current state before jumping
    setResponses(prev => ({
      ...prev,
      [q.id]: {
        ...prev[q.id],
        status: prev[q.id].status === 'NOT_VISITED' || prev[q.id].status === 'NOT_ANSWERED'
          ? (currentRes.answer ? 'ANSWERED' : 'NOT_ANSWERED')
          : prev[q.id].status
      }
    }));

    const nextQ = questions[index];
    setCurrentQuestionIndex(index);
    setCurrentSubject(nextQ.subject);

    if (responses[nextQ.id].status === 'NOT_VISITED') {
      setResponses(prev => ({
        ...prev,
        [nextQ.id]: { ...prev[nextQ.id], status: 'NOT_ANSWERED' }
      }));
    }
  };

  const submitTest = () => {
    setShowSubmitConfirm(true);
  };

  const calculateScore = () => {
    let score = 0;
    let correct = 0;
    let incorrect = 0;
    let unattempted = 0;
    let partial = 0;
    const questionScores: Record<string, number> = {};

    questions.forEach(q => {
      const res = responses[q.id];
      if (res.status === 'ANSWERED' || res.status === 'ANSWERED_AND_MARKED') {
        if (!res.answer || res.answer.trim() === '') {
          unattempted++;
          questionScores[q.id] = 0;
          return;
        }

        let isCorrect = false;
        let isPartial = false;
        let partialScore = 0;

        if (q.type === 'MULTIPLE_CORRECT') {
          const userAns = res.answer.split(',').sort().join(',');
          const actualAns = q.answer.split(',').sort().join(',');
          if (userAns === actualAns) {
            isCorrect = true;
          } else if (testType === 'ADVANCED') {
            const userAnsArr = res.answer.split(',').filter(Boolean);
            const actualAnsArr = q.answer.split(',').filter(Boolean);
            const isSubset = userAnsArr.every(a => actualAnsArr.includes(a));
            if (isSubset && userAnsArr.length > 0) {
              isPartial = true;
              if (actualAnsArr.length === 4 && userAnsArr.length === 2) {
                partialScore = 3;
              } else {
                partialScore = userAnsArr.length;
              }
            }
          }
        } else if (q.type === 'NUMERICAL') {
          const userVal = parseFloat(res.answer);
          const actualAns = q.answer;
          if (actualAns.includes('to')) {
            const [min, max] = actualAns.split('to').map(s => parseFloat(s.trim()));
            if (userVal >= min && userVal <= max) isCorrect = true;
          } else {
            if (Math.abs(userVal - parseFloat(actualAns)) < 0.01 || res.answer.trim() === actualAns.trim()) {
              isCorrect = true;
            }
          }
        } else if (q.type === 'MATRIX_MATCH') {
          isCorrect = res.answer.replace(/\s/g, '') === q.answer.replace(/\s/g, '');
        } else {
          isCorrect = res.answer === q.answer;
        }

        let qScore = 0;
        if (testType === 'MAIN') {
          if (isCorrect) {
            qScore = 4;
            correct++;
          } else {
            qScore = -1;
            incorrect++;
          }
        } else {
          // ADVANCED
          if (isCorrect) {
            if (q.type === 'MULTIPLE_CORRECT' || q.type === 'NUMERICAL') {
              if (q.type === 'NUMERICAL' && /^\d$/.test(q.answer.trim())) {
                qScore = 3;
              } else {
                qScore = 4;
              }
            } else {
              qScore = 3;
            }
            correct++;
          } else if (isPartial) {
            qScore = partialScore;
            partial++;
          } else {
            if (q.type === 'MULTIPLE_CORRECT') {
              qScore = -2;
            } else if (q.type === 'NUMERICAL') {
              if (/^\d$/.test(q.answer.trim())) {
                qScore = -1;
              } else {
                qScore = 0;
              }
            } else {
              qScore = -1;
            }
            incorrect++;
          }
        }
        score += qScore;
        questionScores[q.id] = qScore;
      } else {
        unattempted++;
        questionScores[q.id] = 0;
      }
    });

    return { score, correct, incorrect, unattempted, partial, questionScores };
  };

  const confirmSubmit = () => {
    setShowSubmitConfirm(false);

    const { score, correct, incorrect, unattempted } = calculateScore();

    const newHistory = [
      {
        date: new Date().toISOString(),
        testType,
        score,
        correct,
        incorrect,
        unattempted,
        totalQuestions: questions.length
      },
      ...testHistory
    ];
    setTestHistory(newHistory);
    localStorage.setItem('jee_test_history', JSON.stringify(newHistory));

    setStep('RESULT');
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getStatusColor = (status: QuestionStatus) => {
    switch (status) {
      case 'ANSWERED': return 'bg-green-500 text-white';
      case 'NOT_ANSWERED': return 'bg-red-500 text-white';
      case 'NOT_VISITED': return 'bg-gray-200 text-gray-700';
      case 'MARKED_FOR_REVIEW': return 'bg-purple-500 text-white';
      case 'ANSWERED_AND_MARKED': return 'bg-purple-500 text-white relative after:content-[""] after:w-2 after:h-2 after:bg-green-500 after:absolute after:bottom-0 after:right-0 after:rounded-full';
      default: return 'bg-gray-200 text-gray-700';
    }
  };

  const getStatusShape = (status: QuestionStatus) => {
    if (status === 'ANSWERED' || status === 'NOT_ANSWERED') return 'rounded-t-lg rounded-b-none clip-path-polygon';
    if (status === 'MARKED_FOR_REVIEW' || status === 'ANSWERED_AND_MARKED') return 'rounded-full';
    return 'rounded-md';
  };

  if (step === 'SETUP') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-blue-600 p-6 text-white text-center">
            <h1 className="text-2xl font-bold">JEE CBT Simulator</h1>
            <p className="text-blue-100 mt-2">Upload a mock test PDF to begin</p>
          </div>

          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Test Type</label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setTestType('MAIN')}
                  className={clsx(
                    "py-2 px-4 border rounded-md font-medium transition-colors",
                    testType === 'MAIN' ? "bg-blue-50 border-blue-500 text-blue-700" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                  )}
                >
                  JEE Main
                </button>
                <button
                  onClick={() => setTestType('ADVANCED')}
                  className={clsx(
                    "py-2 px-4 border rounded-md font-medium transition-colors",
                    testType === 'ADVANCED' ? "bg-blue-50 border-blue-500 text-blue-700" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                  )}
                >
                  JEE Advanced
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Upload Mock Test (PDF)</label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md hover:border-blue-400 transition-colors">
                <div className="space-y-1 text-center">
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="flex text-sm text-gray-600 justify-center">
                    <label htmlFor="file-upload" className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500">
                      <span>Upload a file</span>
                      <input id="file-upload" name="file-upload" type="file" accept="application/pdf" className="sr-only" onChange={handleFileUpload} ref={fileInputRef} />
                    </label>
                  </div>
                  <p className="text-xs text-gray-500">PDF up to 10MB</p>
                  {pdfFile && <p className="text-sm font-medium text-green-600 mt-2">{pdfFile.name}</p>}
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2 text-center">
                Upload PDF with question paper and answer key in one. If not, go to <a href="https://www.ilovepdf.com/merge_pdf" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">this website</a> to merge it.
              </p>
            </div>

            <button
              onClick={isReady ? startTest : processPdf}
              disabled={!pdfFile || isProcessing || (!apiKey && !(import.meta as any).env.VITE_GEMINI_API_KEY && !process.env.GEMINI_API_KEY)}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <div className="flex flex-col items-center w-full">
                  <span className="flex items-center mb-2"><svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Processing PDF...</span>
                  <div className="w-full bg-gray-300 rounded-full h-2.5">
                    <div className="bg-white h-2.5 rounded-full transition-all duration-500" style={{ width: `${processingProgress}%` }}></div>
                  </div>
                </div>
              ) : isReady ? (
                <span className="flex items-center"><Play className="w-4 h-4 mr-2" /> Start Mock Test</span>
              ) : (
                <span className="flex items-center"><Play className="w-4 h-4 mr-2" /> Process PDF</span>
              )}
            </button>
            <div className="mt-3 flex items-center justify-center gap-3 text-xs text-gray-600">
              <span>
                API Key: {apiKey ? 'Saved in browser' : (import.meta as any).env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY ? 'Loaded from .env' : 'Not set'}
              </span>
              <button
                onClick={() => setShowApiKeyPrompt(true)}
                className="text-blue-600 hover:underline"
              >
                Set / Change Key
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem('gemini_api_key');
                  setApiKey('');
                }}
                className="text-red-600 hover:underline"
              >
                Clear Saved Key
              </button>
            </div>
            <div className="text-center mt-4 space-y-3">
              <button onClick={startDemoTest} className="text-sm text-blue-600 hover:underline">
                Or try Demo Mode (No PDF required)
              </button>

              {testHistory.length > 0 && (
                <div>
                  <button
                    onClick={() => setStep('HISTORY')}
                    className="text-sm text-gray-600 hover:text-gray-800 font-medium inline-flex items-center"
                  >
                    <Bookmark className="w-4 h-4 mr-1" /> View Test History
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* API Key Modal */}
        {showApiKeyPrompt && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
              <h3 className="text-xl font-bold mb-2 text-gray-800">Enter Gemini API Key</h3>
              <p className="text-sm text-gray-600 mb-4">
                To process PDFs, you need a Google Gemini API key. It will be saved locally in your browser.
              </p>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full p-3 border border-gray-300 rounded-md mb-4 focus:ring-blue-500 focus:border-blue-500"
              />
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowApiKeyPrompt(false)}
                  className="px-4 py-2 border rounded-md text-gray-700 font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (apiKey.trim()) {
                      localStorage.setItem('gemini_api_key', apiKey.trim());
                      setShowApiKeyPrompt(false);
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:bg-blue-300"
                  disabled={!apiKey.trim()}
                >
                  Save Key
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const resetTest = () => {
    setPdfFile(null);
    setIsReady(false);
    setQuestions([]);
    setResponses({});
    setPdfDoc(null);
    setProcessingProgress(0);
    setStep('SETUP');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (step === 'HISTORY') {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-blue-600 p-6 text-white flex justify-between items-center">
            <h1 className="text-3xl font-bold">Test History</h1>
            <button onClick={resetTest} className="bg-white text-blue-600 px-4 py-2 rounded-md font-medium hover:bg-blue-50">
              Back to Home
            </button>
          </div>
          <div className="p-8">
            {testHistory.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No test history found.</p>
            ) : (
              <div className="space-y-6">
                {testHistory.map((history, index) => (
                  <div key={index} className="border rounded-lg p-6 bg-gray-50 shadow-sm">
                    <div className="flex justify-between items-center mb-4 border-b pb-2">
                      <div className="font-bold text-lg text-gray-800">
                        JEE {history.testType === 'MAIN' ? 'Main' : 'Advanced'} Mock Test
                      </div>
                      <div className="text-sm text-gray-500">
                        {new Date(history.date).toLocaleString()}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-xs text-gray-500 uppercase font-semibold">Score</div>
                        <div className="text-2xl font-bold text-blue-600">{history.score}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-gray-500 uppercase font-semibold">Correct</div>
                        <div className="text-2xl font-bold text-green-600">{history.correct}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-gray-500 uppercase font-semibold">Incorrect</div>
                        <div className="text-2xl font-bold text-red-600">{history.incorrect}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-gray-500 uppercase font-semibold">Unattempted</div>
                        <div className="text-2xl font-bold text-gray-600">{history.unattempted}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step === 'RESULT') {
    const { score, correct, incorrect, unattempted, partial, questionScores } = calculateScore();

    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-blue-600 p-6 text-white text-center">
            <h1 className="text-3xl font-bold">Test Result</h1>
          </div>
          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-blue-50 p-6 rounded-lg text-center border border-blue-100">
                <div className="text-sm text-blue-600 font-semibold uppercase tracking-wider">Total Score</div>
                <div className="text-4xl font-bold text-blue-900 mt-2">{score}</div>
              </div>
              <div className="bg-green-50 p-6 rounded-lg text-center border border-green-100">
                <div className="text-sm text-green-600 font-semibold uppercase tracking-wider">Correct</div>
                <div className="text-4xl font-bold text-green-900 mt-2">{correct}</div>
              </div>
              <div className="bg-red-50 p-6 rounded-lg text-center border border-red-100">
                <div className="text-sm text-red-600 font-semibold uppercase tracking-wider">Incorrect</div>
                <div className="text-4xl font-bold text-red-900 mt-2">{incorrect}</div>
              </div>
              <div className="bg-gray-50 p-6 rounded-lg text-center border border-gray-200">
                <div className="text-sm text-gray-600 font-semibold uppercase tracking-wider">Unattempted</div>
                <div className="text-4xl font-bold text-gray-900 mt-2">{unattempted}</div>
              </div>
            </div>

            <h2 className="text-xl font-bold mb-4 border-b pb-2">Detailed Analysis</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Q.No</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Your Answer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Correct Answer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time Spent</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Marks</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {questions.map(q => {
                    const res = responses[q.id];
                    const isAttempted = (res.status === 'ANSWERED' || res.status === 'ANSWERED_AND_MARKED') && res.answer && res.answer.trim() !== '';

                    let isCorrect = false;
                    let isPartial = false;
                    if (isAttempted) {
                      if (q.type === 'MULTIPLE_CORRECT') {
                        isCorrect = res.answer.split(',').sort().join(',') === q.answer.split(',').sort().join(',');
                        if (!isCorrect && testType === 'ADVANCED') {
                          const userAnsArr = res.answer.split(',').filter(Boolean);
                          const actualAnsArr = q.answer.split(',').filter(Boolean);
                          isPartial = userAnsArr.every(a => actualAnsArr.includes(a)) && userAnsArr.length > 0;
                        }
                      } else if (q.type === 'NUMERICAL') {
                        const userVal = parseFloat(res.answer);
                        if (q.answer.includes('to')) {
                          const [min, max] = q.answer.split('to').map(s => parseFloat(s.trim()));
                          if (userVal >= min && userVal <= max) isCorrect = true;
                        } else {
                          if (Math.abs(userVal - parseFloat(q.answer)) < 0.01 || res.answer.trim() === q.answer.trim()) {
                            isCorrect = true;
                          }
                        }
                      } else if (q.type === 'MATRIX_MATCH') {
                        isCorrect = res.answer.replace(/\s/g, '') === q.answer.replace(/\s/g, '');
                      } else {
                        isCorrect = res.answer === q.answer;
                      }
                    }

                    const timeMins = Math.floor((res.timeSpent || 0) / 60);
                    const timeSecs = (res.timeSpent || 0) % 60;
                    const timeStr = `${timeMins}:${timeSecs.toString().padStart(2, '0')}`;

                    const qScore = questionScores[q.id] || 0;

                    return (
                      <tr key={q.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{q.questionNumber}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{q.subject}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{res.answer || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{q.answer}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{timeStr}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <span className={qScore > 0 ? "text-green-600" : qScore < 0 ? "text-red-600" : "text-gray-500"}>
                            {qScore > 0 ? `+${qScore}` : qScore}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {!isAttempted ? (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">Unattempted</span>
                          ) : isCorrect ? (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Correct</span>
                          ) : isPartial ? (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">Partial</span>
                          ) : (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Incorrect</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-8 flex justify-center space-x-4">
              <button onClick={resetTest} className="bg-blue-600 text-white px-6 py-2 rounded-md font-medium hover:bg-blue-700 shadow-sm">
                Take Another Test
              </button>
              <button onClick={() => setStep('HISTORY')} className="bg-white text-gray-700 border border-gray-300 px-6 py-2 rounded-md font-medium hover:bg-gray-50 shadow-sm">
                View Test History
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentQuestionIndex];
  const currentRes = responses[currentQ?.id];

  // Group questions by subject and section
  const subjectSections = Array.from(new Set<string>(questions.map(q => `${q.subject}::${q.section}`))).map(str => {
    const [subject, section] = str.split('::');
    return { subject, section };
  });

  return (
    <div className={clsx(
      "flex flex-col h-screen font-sans overflow-hidden",
      isDark ? "theme-dark bg-slate-900 text-slate-100" : "bg-white text-gray-900"
    )}>
      {/* Top Header */}
      <header className="bg-[#1e4e8c] text-white flex justify-between items-center px-4 py-2 shadow-md z-10">
        <div className="font-bold text-xl tracking-wide">JEE ({testType === 'MAIN' ? 'Main' : 'Advanced'}) Mock Test</div>
        <div className="flex items-center space-x-6">
          <div className="text-right">
            <div className="text-xs text-blue-200">Time Left</div>
            <div className="font-mono text-lg font-bold">{formatTime(timeLeft)}</div>
          </div>
          <div className="flex items-center bg-white/10 px-3 py-1 rounded-md">
            <User className="w-5 h-5 mr-2" />
            <span className="text-sm font-medium">Candidate</span>
          </div>
          <button
            onClick={() => setIsDark(prev => !prev)}
            className="flex items-center bg-white/10 px-3 py-1 rounded-md text-sm font-medium hover:bg-white/20 transition-colors"
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {isDark ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
            {isDark ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      {/* Subjects Bar */}
      <div className="bg-gray-100 border-b flex flex-wrap items-center px-2 py-1">
        {subjectSections.map(({ subject, section }) => {
          const isCurrent = currentQ?.subject === subject && currentQ?.section === section;
          // Find the first question of this section to determine the type for the tooltip
          const firstQ = questions.find(q => q.subject === subject && q.section === section);
          const markingScheme = testType === 'MAIN'
            ? "All Questions: +4, -1, 0"
            : firstQ?.type === 'SINGLE_CORRECT' ? "Single Correct: +3, -1, 0" :
              firstQ?.type === 'MULTIPLE_CORRECT' ? "Multiple Correct: +4, +1, -2, 0" :
                firstQ?.type === 'NUMERICAL' ? "Numerical: +4, 0 (or +3, -1 for single digit)" :
                  "Matrix Match: +3, -1, 0";
          return (
            <button
              key={`${subject}-${section}`}
              onClick={() => {
                const firstQIndex = questions.findIndex(q => q.subject === subject && q.section === section);
                if (firstQIndex !== -1) jumpToQuestion(firstQIndex);
              }}
              className={clsx(
                "px-4 py-2 text-sm font-medium rounded-t-md mx-1 transition-colors whitespace-nowrap flex items-center",
                isCurrent
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-200 border border-gray-300 border-b-0"
              )}
            >
              {subject} <span className="text-xs ml-1 opacity-80">({section})</span>
              <div className="relative group flex items-center">
                <Info className="w-3 h-3 ml-2 cursor-help opacity-70 hover:opacity-100 transition-opacity" />
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 bg-gray-800 text-white text-xs rounded shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 whitespace-normal font-normal text-left pointer-events-none">
                  <div className="font-bold mb-2 border-b border-gray-600 pb-1 text-blue-300">Section Progress</div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>Total: <span className="font-bold">{questions.filter(q => q.subject === subject && q.section === section).length}</span></div>
                    <div>Attempted: <span className="font-bold text-green-400">{questions.filter(q => q.subject === subject && q.section === section && responses[q.id]?.status === 'ANSWERED').length}</span></div>
                    <div>Not Answered: <span className="font-bold text-red-400">{questions.filter(q => q.subject === subject && q.section === section && responses[q.id]?.status === 'NOT_ANSWERED').length}</span></div>
                    <div>Not Visited: <span className="font-bold text-gray-400">{questions.filter(q => q.subject === subject && q.section === section && (!responses[q.id] || responses[q.id]?.status === 'NOT_VISITED')).length}</span></div>
                    <div>Marked: <span className="font-bold text-purple-400">{questions.filter(q => q.subject === subject && q.section === section && responses[q.id]?.status === 'MARKED_FOR_REVIEW').length}</span></div>
                    <div className="col-span-2">Ans & Marked: <span className="font-bold text-purple-300">{questions.filter(q => q.subject === subject && q.section === section && responses[q.id]?.status === 'ANSWERED_AND_MARKED').length}</span></div>
                  </div>
                  <div className="font-bold mb-1 border-t border-gray-600 pt-2 text-blue-300">Marking Scheme</div>
                  {markingScheme}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Question */}
        <div className="flex-1 flex flex-col border-r bg-white overflow-hidden">
          {/* Question Header */}
          <div className="flex justify-between items-center px-4 py-2 border-b bg-gray-50">
            <div className="font-bold text-gray-800 flex items-center">
              Question No. {currentQ?.questionNumber}
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <span className="mr-4 flex items-center relative">
                <div className="relative group mr-1 flex items-center">
                  <Info className="w-4 h-4 text-blue-500 cursor-help" />
                  <div className="absolute top-full right-0 mt-2 w-72 p-3 bg-gray-800 text-white text-xs rounded shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 whitespace-normal font-normal pointer-events-none">
                    <div className="font-bold mb-1 border-b border-gray-600 pb-1 text-blue-300">Section Details</div>
                    {testType === 'MAIN' ? (
                      <div className="space-y-1">
                        <p className="font-semibold text-gray-300">JEE Main Marking:</p>
                        <p className="text-green-400">+4 for correct answer</p>
                        <p className="text-red-400">-1 for incorrect answer</p>
                        <p className="text-gray-400">0 for unattempted</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {currentQ?.type === 'SINGLE_CORRECT' && <><p className="font-semibold text-gray-300">Type: Single Correct (MCQ)</p><p>Marking: <span className="text-green-400">+3</span> for correct, <span className="text-red-400">-1</span> for incorrect, <span className="text-gray-400">0</span> for unattempted.</p></>}
                        {currentQ?.type === 'MULTIPLE_CORRECT' && <><p className="font-semibold text-gray-300">Type: Multiple Correct (MSQ)</p><p>Marking: <span className="text-green-400">+4</span> if all correct options chosen, <span className="text-green-300">+3</span> if 4 correct but 2 chosen, <span className="text-yellow-400">+1</span> for each correct option chosen (no incorrect), <span className="text-red-400">-2</span> for incorrect, <span className="text-gray-400">0</span> for unattempted.</p></>}
                        {currentQ?.type === 'NUMERICAL' && <><p className="font-semibold text-gray-300">Type: Numerical / Decimal Type</p><p>Marking: <span className="text-green-400">+4</span> for correct decimal, <span className="text-green-300">+3</span> for correct single-digit integer, <span className="text-gray-400">0</span> for incorrect/unattempted.</p></>}
                        {currentQ?.type === 'MATRIX_MATCH' && <><p className="font-semibold text-gray-300">Type: Matrix Match</p><p>Marking: <span className="text-green-400">+3</span> for correct, <span className="text-red-400">-1</span> for incorrect, <span className="text-gray-400">0</span> for unattempted.</p></>}
                      </div>
                    )}
                  </div>
                </div>
                Marks:
                {testType === 'MAIN' ? (
                  <><span className="text-green-600 font-bold ml-1">+4</span> / <span className="text-red-600 font-bold">-1</span></>
                ) : (
                  <>
                    {currentQ?.type === 'SINGLE_CORRECT' && <><span className="text-green-600 font-bold ml-1">+3</span> / <span className="text-red-600 font-bold">-1</span></>}
                    {currentQ?.type === 'MULTIPLE_CORRECT' && <><span className="text-green-600 font-bold ml-1">+4</span> / <span className="text-yellow-600 font-bold">+1</span> / <span className="text-red-600 font-bold">-2</span></>}
                    {currentQ?.type === 'NUMERICAL' && <><span className="text-green-600 font-bold ml-1">+4</span> / <span className="text-gray-600 font-bold">0</span></>}
                    {currentQ?.type === 'MATRIX_MATCH' && <><span className="text-green-600 font-bold ml-1">+3</span> / <span className="text-red-600 font-bold">-1</span></>}
                  </>
                )}
              </span>
              <button className="flex items-center text-blue-600 hover:underline mr-4">
                <Bookmark className="w-4 h-4 mr-1" /> Bookmark
              </button>
              <button
                onClick={() => setShowPalette(!showPalette)}
                className="flex items-center text-gray-600 hover:text-gray-900 bg-gray-200 px-2 py-1 rounded-md transition-colors"
                title={showPalette ? "Hide Question Palette" : "Show Question Palette"}
              >
                {showPalette ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Question Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-8 border rounded-lg p-4 shadow-sm bg-white min-h-[200px] flex flex-col items-center justify-center" ref={canvasContainerRef}>
              {!pdfDoc && (
                <div className="text-center text-gray-500 w-full">
                  <p className="text-lg font-medium">Demo Mode</p>
                  <p>Question {currentQ?.questionNumber} for {currentQ?.subject}</p>
                </div>
              )}
            </div>

            {/* Options / Input */}
            <div className="max-w-2xl mx-auto">
              {currentQ?.type === 'SINGLE_CORRECT' && (
                <div className="space-y-3">
                  {['A', 'B', 'C', 'D'].map(opt => (
                    <label key={opt} className={clsx(
                      "flex items-center p-4 border rounded-lg cursor-pointer transition-colors",
                      currentRes?.answer === opt ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:bg-gray-50"
                    )}>
                      <input
                        type="radio"
                        name="option"
                        value={opt}
                        checked={currentRes?.answer === opt}
                        onChange={() => handleAnswerChange(opt)}
                        className="w-5 h-5 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span className="ml-3 text-lg font-medium text-gray-700">Option {opt}</span>
                    </label>
                  ))}
                </div>
              )}
              {currentQ?.type === 'MULTIPLE_CORRECT' && (
                <div className="space-y-3">
                  {['A', 'B', 'C', 'D'].map(opt => {
                    const isChecked = currentRes?.answer?.split(',').includes(opt) || false;
                    return (
                      <label key={opt} className={clsx(
                        "flex items-center p-4 border rounded-lg cursor-pointer transition-colors",
                        isChecked ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:bg-gray-50"
                      )}>
                        <input
                          type="checkbox"
                          value={opt}
                          checked={isChecked}
                          onChange={(e) => {
                            let newAns = currentRes?.answer ? currentRes.answer.split(',') : [];
                            if (e.target.checked) {
                              newAns.push(opt);
                            } else {
                              newAns = newAns.filter(a => a !== opt);
                            }
                            handleAnswerChange(newAns.sort().join(','));
                          }}
                          className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="ml-3 text-lg font-medium text-gray-700">Option {opt}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {currentQ?.type === 'NUMERICAL' && (
                <div className="p-6 border rounded-lg bg-gray-50">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Enter your numerical answer:</label>
                  <input
                    type="text"
                    value={currentRes?.answer || ''}
                    onChange={(e) => handleAnswerChange(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                    placeholder="e.g. 4.50"
                  />
                </div>
              )}
              {currentQ?.type === 'MATRIX_MATCH' && (
                <div className="p-6 border rounded-lg bg-gray-50">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Enter your matrix match answer (e.g. A-P,Q; B-R; C-S; D-P):</label>
                  <input
                    type="text"
                    value={currentRes?.answer || ''}
                    onChange={(e) => handleAnswerChange(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                    placeholder="A-P,Q; B-R; C-S; D-P"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="border-t p-4 bg-gray-50 flex justify-between items-center">
            <div className="space-x-3 flex items-center">
              <button onClick={markForReviewAndNext} className="px-6 py-2 border border-gray-300 bg-white text-gray-700 rounded-md font-medium hover:bg-gray-50 transition-colors">
                Mark for Review & Next
              </button>
              <button onClick={clearResponse} className="px-6 py-2 border border-gray-300 bg-white text-gray-700 rounded-md font-medium hover:bg-gray-50 transition-colors">
                Clear Response
              </button>
            </div>
            <div className="flex items-center space-x-3">
              {!showPalette && (
                <button onClick={submitTest} className="px-6 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 transition-colors shadow-sm">
                  Submit Test
                </button>
              )}
              <button onClick={saveAndNext} className="px-8 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors shadow-sm">
                Save & Next
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel - Palette */}
        {showPalette && (
          <div className="w-80 bg-gray-50 flex flex-col overflow-hidden border-l">
            {/* Legend */}
            <div className="p-4 border-b bg-white grid grid-cols-2 gap-y-3 gap-x-2 text-xs">
              <div className="flex items-center"><div className="w-6 h-6 bg-green-500 rounded-t-lg mr-2 flex-shrink-0"></div> Answered</div>
              <div className="flex items-center"><div className="w-6 h-6 bg-red-500 rounded-t-lg mr-2 flex-shrink-0"></div> Not Answered</div>
              <div className="flex items-center"><div className="w-6 h-6 bg-gray-200 rounded-md mr-2 flex-shrink-0 border"></div> Not Visited</div>
              <div className="flex items-center"><div className="w-6 h-6 bg-purple-500 rounded-full mr-2 flex-shrink-0"></div> Marked for Review</div>
              <div className="flex items-center col-span-2"><div className="w-6 h-6 bg-purple-500 rounded-full mr-2 flex-shrink-0 relative after:content-[''] after:w-2 after:h-2 after:bg-green-500 after:absolute after:bottom-0 after:right-0 after:rounded-full"></div> Answered & Marked for Review</div>
            </div>

            {/* Palette Grid */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="bg-blue-100 text-blue-800 font-bold py-2 px-3 rounded-md mb-4 text-sm">
                {currentQ?.subject} - {currentQ?.section}
              </div>

              <div className="grid grid-cols-4 gap-3">
                {questions.filter(q => q.subject === currentQ?.subject && q.section === currentQ?.section).map(q => {
                  const status = responses[q.id]?.status || 'NOT_VISITED';
                  return (
                    <button
                      key={q.id}
                      onClick={() => jumpToQuestion(questions.findIndex(x => x.id === q.id))}
                      className={clsx(
                        "w-12 h-12 flex items-center justify-center font-bold text-sm transition-transform hover:scale-105",
                        getStatusColor(status),
                        getStatusShape(status),
                        currentQ?.id === q.id ? "ring-2 ring-offset-2 ring-blue-500" : ""
                      )}
                      style={status === 'ANSWERED' || status === 'NOT_ANSWERED' ? { clipPath: 'polygon(50% 0%, 100% 25%, 100% 100%, 0% 100%, 0% 25%)' } : {}}
                    >
                      {q.questionNumber}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Submit Button */}
            <div className="p-4 border-t bg-white">
              <button onClick={submitTest} className="w-full py-3 bg-green-600 text-white rounded-md font-bold text-lg hover:bg-green-700 transition-colors shadow-md">
                Submit Test
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Submit Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full">
            <h3 className="text-xl font-bold mb-2 text-gray-800">Submit Test</h3>
            <p className="text-gray-600 mb-6">Are you sure you want to submit the test? You cannot change your answers after submission.</p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowSubmitConfirm(false)} className="px-4 py-2 border rounded-md text-gray-700 font-medium hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={confirmSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors">
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
