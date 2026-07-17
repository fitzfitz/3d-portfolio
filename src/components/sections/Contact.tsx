import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Send, CheckCircle2, ShieldAlert, Terminal } from "lucide-react";

interface ContactProps {
  isSidebar?: boolean;
}

export default function Contact({ isSidebar = false }: ContactProps) {
  const [formData, setFormData] = useState({ name: "", email: "", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formStatus, setFormStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);

  // Simulation terminal logs
  const simulationSteps = [
    "Establishing secure socket connection...",
    "Validating payload headers...",
    "Encrypting message contents with PGP...",
    "Dispatching packet to smtp.fitzgeral.dev...",
    "Transmission successfully completed! Status 200 OK.",
  ];

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = "Name is required";
    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = "Please specify a valid email address";
    }
    if (!formData.message.trim()) newErrors.message = "Message cannot be empty";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setFormStatus("submitting");
    setTerminalLogs([]);

    // Run terminal logs sequence
    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < simulationSteps.length) {
        setTerminalLogs((prev) => [...prev, `[system] > ${simulationSteps[currentStep]}`]);
        currentStep++;
      } else {
        clearInterval(interval);
        setFormStatus("success");
        setFormData({ name: "", email: "", message: "" });
      }
    }, 400);
  };

  const formCard = (
    <div className={isSidebar ? "glass-card rounded-2xl p-6 relative w-full border border-accent/20 bg-black/85 max-h-[85vh] overflow-hidden pointer-events-auto" : "glass-card rounded-2xl p-6 sm:p-8 relative overflow-hidden"}>
      {isSidebar && (
        <h3 className="font-display font-extrabold text-xl mb-4 text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          Send Secure Message
        </h3>
      )}
      <AnimatePresence mode="wait">
        {formStatus === "success" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-12 text-center animate-fade-in"
          >
            <CheckCircle2 className="w-16 h-16 text-primary mb-6 animate-bounce" />
            <h3 className="font-display font-bold text-2xl mb-2">Transmission Dispatched!</h3>
            <p className="text-muted text-sm max-w-xs mb-6">
              Your transmission has been encrypted and sent to my inbox. I'll analyze it and get back to you shortly.
            </p>
            <button
              onClick={() => setFormStatus("idle")}
              className="px-5 py-2.5 rounded-lg font-mono text-xs text-primary border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer"
            >
              SEND_ANOTHER_PACKET
            </button>
          </motion.div>
        ) : formStatus === "submitting" ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col min-h-[300px] justify-between font-mono text-xs text-white/70 bg-black/40 border border-white/5 rounded-xl p-4"
          >
            {/* Console Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-4">
              <span className="flex items-center gap-1.5 text-primary">
                <Terminal className="w-3.5 h-3.5" />
                MAILER_DAEMON.EXE
              </span>
              <span className="animate-pulse w-2 h-2 rounded-full bg-primary" />
            </div>

            {/* Console Logs */}
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[220px] font-mono leading-relaxed select-none">
              {terminalLogs.map((log, idx) => (
                <div key={idx} className="animate-fade-in text-[11px] sm:text-xs">
                  {log}
                </div>
              ))}
              <div className="animate-pulse inline-block w-1.5 h-4 bg-primary ml-1" />
            </div>

            {/* Console Footer */}
            <div className="border-t border-white/5 pt-2 mt-4 text-[10px] text-white/30 text-right">
              ENCRYPTION: AES-GCM-256
            </div>
          </motion.div>
        ) : (
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            noValidate
            className="space-y-6"
          >
            {/* Name field */}
            <div>
              <label htmlFor="name" className="block text-xs font-mono text-muted mb-2 tracking-wide uppercase">
                Sender Name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className={`w-full px-4 py-3 rounded-xl border bg-black/20 text-white placeholder-white/20 text-sm font-mono focus:outline-none transition-colors ${
                  errors.name ? "border-red-500/50 focus:border-red-500" : "border-white/5 focus:border-primary/50"
                }`}
                placeholder="e.g. HAL 9000"
              />
              {errors.name && (
                <p className="mt-1.5 text-xs text-red-400 font-mono flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {errors.name}
                </p>
              )}
            </div>

            {/* Email field */}
            <div>
              <label htmlFor="email" className="block text-xs font-mono text-muted mb-2 tracking-wide uppercase">
                Sender Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className={`w-full px-4 py-3 rounded-xl border bg-black/20 text-white placeholder-white/20 text-sm font-mono focus:outline-none transition-colors ${
                  errors.email ? "border-red-500/50 focus:border-red-500" : "border-white/5 focus:border-secondary/50"
                }`}
                placeholder="e.g. user@domain.com"
              />
              {errors.email && (
                <p className="mt-1.5 text-xs text-red-400 font-mono flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {errors.email}
                </p>
              )}
            </div>

            {/* Message field */}
            <div>
              <label htmlFor="message" className="block text-xs font-mono text-muted mb-2 tracking-wide uppercase">
                Secure Message Packet
              </label>
              <textarea
                id="message"
                name="message"
                rows={4}
                value={formData.message}
                onChange={handleInputChange}
                className={`w-full px-4 py-3 rounded-xl border bg-black/20 text-white placeholder-white/20 text-sm font-mono focus:outline-none transition-colors resize-none ${
                  errors.message ? "border-red-500/50 focus:border-red-500" : "border-white/5 focus:border-accent/50"
                }`}
                placeholder="Write your transmission payload..."
              />
              {errors.message && (
                <p className="mt-1.5 text-xs text-red-400 font-mono flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {errors.message}
                </p>
              )}
            </div>

            {/* Send Button */}
            <button
              type="submit"
              className="w-full py-4 rounded-xl font-mono text-sm bg-gradient-to-r from-primary via-secondary to-accent text-black font-bold hover:shadow-neonGreen transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
            >
              DISPATCH_TRANSMISSION
              <Send className="w-4 h-4" />
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );

  if (isSidebar) {
    return formCard;
  }

  return (
    <section id="contact" className="min-h-screen py-24 relative w-full flex items-center justify-center overflow-hidden bg-background">
      {/* Background glow */}
      <div className="absolute bottom-[-10%] left-[20%] w-[350px] h-[350px] rounded-full bg-primary/5 blur-[120px] pointer-events-none animate-pulse" />

      <div className="max-w-7xl mx-auto px-6 w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center z-10">
        {/* Left Column: Title & Info */}
        <div className="lg:col-span-4 flex flex-col justify-center text-left">
          <p className="font-mono text-xs text-accent tracking-widest uppercase mb-2">
            // SECURE_COMMUNICATION_TUNNEL
          </p>
          <h2 className="font-display font-black text-3xl sm:text-4xl lg:text-5xl mb-6">
            Get In Touch
          </h2>
          <p className="text-muted text-sm sm:text-base font-light leading-relaxed mb-8 max-w-sm">
            Have a project in mind, want to explore custom AI integrations, or looking to collaborate? Drop me a secure packet transmission.
          </p>

          <div className="flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/2 max-w-sm">
            <div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-mono text-muted">DIRECT_MAIL</p>
              <a href="mailto:hello@example.com" className="text-sm font-mono text-white hover:text-accent transition-colors">
                hello@example.com
              </a>
            </div>
          </div>
        </div>

        {/* Middle Column */}
        <div className="hidden lg:block lg:col-span-3 h-[400px] pointer-events-none" />

        {/* Right Column */}
        <div className="lg:col-span-5 w-full">
          {formCard}
        </div>
      </div>
    </section>
  );
}
