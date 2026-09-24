import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Teacher from "./pages/Teacher.tsx";
import Share from "./pages/Share.tsx";
import Take from "./pages/Take.tsx";
import Result from "./pages/Result.tsx";
import Results from "./pages/Results.tsx";
import Auth from "./pages/Auth.tsx";
import EditExam from "./pages/EditExam.tsx";
import Exams from "./pages/Exams.tsx";
import Students from "./pages/Students.tsx";
import Reports from "./pages/Reports.tsx";
import Library from "./pages/Library.tsx";
import Subjects from "./pages/Subjects.tsx";
import ShufflePage from "./pages/Shuffle.tsx";
import TeamTake from "./pages/TeamTake.tsx";
import TeamLeaderboard from "./pages/TeamLeaderboard.tsx";
import StudentAuth from "./pages/StudentAuth.tsx";
import StudentDashboard from "./pages/StudentDashboard.tsx";
import AdminDashboard from "./pages/AdminDashboard.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            {/* public student routes */}
            <Route path="/student" element={<StudentDashboard />} />
            <Route path="/student/auth" element={<StudentAuth />} />
            <Route path="/take/:id" element={<Take />} />
            <Route path="/result/:id" element={<Result />} />
            <Route path="/team/:id" element={<TeamTake />} />
            <Route path="/leaderboard/:id" element={<TeamLeaderboard />} />
            {/* admin routes */}
            <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/*" element={<ProtectedRoute requireAdmin><AdminDashboard /></ProtectedRoute>} />
            {/* teacher routes */}
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/teacher" element={<ProtectedRoute><Teacher /></ProtectedRoute>} />
            <Route path="/exams" element={<ProtectedRoute><Exams /></ProtectedRoute>} />
            <Route path="/library" element={<ProtectedRoute><Library /></ProtectedRoute>} />
            <Route path="/subjects" element={<ProtectedRoute><Subjects /></ProtectedRoute>} />
            <Route path="/shuffle" element={<ProtectedRoute><ShufflePage /></ProtectedRoute>} />
            <Route path="/students" element={<ProtectedRoute><Students /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/exam/:id/share" element={<ProtectedRoute><Share /></ProtectedRoute>} />
            <Route path="/exam/:id/results" element={<ProtectedRoute><Results /></ProtectedRoute>} />
            <Route path="/exam/:id/edit" element={<ProtectedRoute><EditExam /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
