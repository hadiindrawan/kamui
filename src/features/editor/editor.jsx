import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Film, HardDrive, Settings, ZoomIn, Crop, ChevronsLeft, ChevronsRight, Captions } from 'lucide-react';
import CanvasPlayer from './components/CanvasPlayer.jsx';
import Timeline from './components/Timeline.jsx';
import EditorToolbar from './components/EditorToolbar.jsx';
import SidebarSettings from './components/SidebarSettings.jsx';
import SegmentInspector from './components/SegmentInspector.jsx';
import FramingPanel from './components/FramingPanel.jsx';
import CaptionsPanel from './components/CaptionsPanel.jsx';
import ExportPanel from './components/ExportPanel.jsx';
import ZoomTargetOverlay from './components/ZoomTargetOverlay.jsx';
import CropPanOverlay from './components/CropPanOverlay.jsx';
import PresetManagerModal from './components/PresetManagerModal.jsx';
import AutoExportCountdown from './components/AutoExportCountdown.jsx';
import ShortcutsModal from './components/ShortcutsModal.jsx';
import { useEditorState } from './hooks/useEditorState.js';
import { usePresets } from './hooks/usePresets.js';
import { ToastProvider } from '../../shared/components/Toast.jsx';
import ConfirmDialog from '../../shared/components/ConfirmDialog.jsx';
import Tabs from '../../shared/components/Tabs.jsx';
import Button from '../../shared/components/Button.jsx';
import './editor.css';

const SIDEBAR_COLLAPSED_KEY = 'kamui.sidebarCollapsed';

export default function Editor() {
    return (
        <ToastProvider>
            <EditorContent />
        </ToastProvider>
    );
}

function EditorContent() {
    const state = useEditorState();
    const {
        canvasPlayerRef, canvasContainerRef,
        recording, loading, error,
        isPlaying, currentTime, duration,
        handlePlayPause, handleTimeUpdate, handlePlaybackEnded, handleFrameTime, registerPlayhead,
        handleDurationChange, handleVideoDimensions, handleSeek, handleSkip,
        loopPlayback, setLoopPlayback,
        zoomLevel, setZoomLevel, zoomDuration, setZoomDuration, transitionDuration, setTransitionDuration,
        autoZoomIntensity, setAutoZoomIntensity, regenerateAutoZoom,
        playbackSpeed, setPlaybackSpeed,
        aspectRatio, setAspectRatio, backgroundMode, setBackgroundMode, backgroundColor, setBackgroundColor,
        backgroundValue, setBackgroundValue, backgroundBlur, setBackgroundBlur, insetPadding, setInsetPadding,
        cropToFill, setCropToFill, cropPanX, cropPanY, updateCropPan, cropZoom, setCropZoom,
        showShadow, setShowShadow, showBorder, setShowBorder, borderRadius, setBorderRadius,
        isMuted, setIsMuted, volume, setVolume, showFollowCursor, setShowFollowCursor,
        cursorSmoothing, setCursorSmoothing,
        clickAnimationStyle, setClickAnimationStyle, clickAnimationOpacity, setClickAnimationOpacity,
        clickSound, setClickSound, clickAnimationInRecording, setClickAnimationInRecording,
        trimStart, trimEnd, markTrimStart, markTrimEnd,
        captions, captionsEnabled, setCaptionsEnabled, burnInCaptions, setBurnInCaptions,
        addCaptionAtPlayhead, updateCaption, deleteCaption, setAllCaptions,
        captionStyle,
        captionFontScale, setCaptionFontScale, captionFontFamily, setCaptionFontFamily,
        captionColor, setCaptionColor, captionBackground, setCaptionBackground,
        captionPosition, setCaptionPosition,
        segments, selectedSegmentId, setSelectedSegmentId, selectSegment, addSegment, updateSegment, deleteSegment,
        requestResetTimeline, performResetTimeline, confirmResetOpen, setConfirmResetOpen,
        handleUndo, handleRedo, saveHistory, handleTrimChange,
        tracks, addTrack, removeTrack,
        hasPendingEdits, setHasPendingEdits, handleSaveChanges,
        shortcutsOpen, setShortcutsOpen,
        isExporting, exportProgress, exportResolution, setExportResolution, exportFps, setExportFps,
        exportFormat, setExportFormat, conversionService, setConversionService,
        exportQuality, setExportQuality, handleExport,
        handleFileUpload,
        getVideoRect, getFrameRect, getVisibleVideoRect, getSceneLayout,
    } = state;

    const presets = usePresets(state);

    const selectedSegment = segments.find((s) => s.id === selectedSegmentId);
    const showZoomOverlay = selectedSegment && selectedSegment.positionMode === 'fixed';
    const showCropOverlay = !showZoomOverlay && cropToFill;
    const videoRect = showCropOverlay ? getVideoRect() : null;
    const frameRect = showCropOverlay ? getFrameRect() : null;
    const zoomFrameRect = showZoomOverlay ? getVisibleVideoRect() : null;
    const zoomSceneLayout = showZoomOverlay ? getSceneLayout() : null;

    const [sidebarTab, setSidebarTab] = useState('video');
    const previousSidebarTabRef = useRef('video');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
        } catch {
            return false;
        }
    });

    useEffect(() => {
        if (selectedSegmentId) {
            setSidebarTab((prev) => {
                if (prev !== 'segment') previousSidebarTabRef.current = prev;
                return 'segment';
            });
            setSidebarCollapsed(false);
        } else {
            setSidebarTab((prev) => (prev === 'segment' ? previousSidebarTabRef.current : prev));
        }
    }, [selectedSegmentId]);

    useEffect(() => {
        try {
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
        } catch {
            // Storage unavailable (private mode, etc.) — collapse state just won't persist.
        }
    }, [sidebarCollapsed]);

    // Auto-collapse on narrow viewports so the canvas/timeline stay usable;
    // doesn't fight a manual expand afterward (matches the footer-wrap
    // breakpoint in editor.css).
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia('(max-width: 1100px)');
        if (mq.matches) setSidebarCollapsed(true);
        const handleChange = (e) => { if (e.matches) setSidebarCollapsed(true); };
        mq.addEventListener('change', handleChange);
        return () => mq.removeEventListener('change', handleChange);
    }, []);

    const sidebarTabs = [
        ...(selectedSegment ? [{
            id: 'segment',
            label: 'Segment',
            icon: selectedSegment.type === 'crop' ? <Crop size={14} /> : <ZoomIn size={14} />,
        }] : []),
        { id: 'video', label: 'Video', icon: <Settings size={14} /> },
        { id: 'frame', label: 'Frame', icon: <Film size={14} /> },
        { id: 'captions', label: 'Captions', icon: <Captions size={14} /> },
    ];

    const urlParams = new URLSearchParams(window.location.search);
    const hasRecordingId = !!urlParams.get('id');

    if (loading) {
        return (
            <div className="editor-loading">
                <div className="spinner"></div>
                <p>Loading recording...</p>
            </div>
        );
    }

    if (!hasRecordingId) {
        return (
            <div className="editor">
                <header className="editor-header">
                    <div className="header-left">
                        <h1 className="header-title">
                            <Film size={22} />
                            Kamui Editor
                        </h1>
                    </div>
                </header>
                <main className="editor-upload-main">
                    <div className="upload-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={handleFileUpload}>
                        <HardDrive size={48} className="upload-icon" />
                        <h2>Upload a Local Video</h2>
                        <p>Drag and drop a .webm, .mp4, or .mov file here</p>
                        <input
                            type="file"
                            id="file-upload"
                            accept="video/webm, video/mp4, video/quicktime"
                            onChange={handleFileUpload}
                            style={{ display: 'none' }}
                        />
                        <label htmlFor="file-upload" className="upload-select-btn">
                            Select File
                        </label>
                    </div>
                </main>
            </div>
        );
    }

    if (error) {
        return (
            <div className="editor-error">
                <h1>Error</h1>
                <p>{error}</p>
            </div>
        );
    }

    return (
        <div className="editor">
            <EditorToolbar
                segmentCount={segments.length}
                recordingSizeBytes={recording.size}
                hasPendingEdits={hasPendingEdits}
                onSaveChanges={handleSaveChanges}
                currentTime={currentTime}
                duration={duration}
                presets={presets.presets}
                activePresetId={presets.activePresetId}
                onApplyPreset={presets.applyPreset}
                onOpenPresetManager={presets.openManager}
                onOpenShortcuts={() => setShortcutsOpen(true)}
            />

            <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

            <AutoExportCountdown countdown={presets.countdown} onCancel={presets.cancelCountdown} />

            <PresetManagerModal
                open={presets.managerOpen}
                onClose={presets.closeManager}
                presets={presets.presets}
                activePresetId={presets.activePresetId}
                storageDegraded={presets.storageDegraded}
                globalAutoExport={presets.globalAutoExport}
                onSetGlobalAutoExport={presets.setGlobalAutoExport}
                globalCursorSmoothing={presets.globalCursorSmoothing}
                onSetGlobalCursorSmoothing={presets.setGlobalCursorSmoothing}
                onSaveCurrentAsPreset={presets.saveCurrentAsPreset}
                onApplyPreset={presets.applyPreset}
                onSetPresetAutoExport={presets.setPresetAutoExport}
                onDeletePreset={presets.deletePresetById}
                onClearActive={() => presets.setActivePreset(null)}
            />

            <ConfirmDialog
                open={confirmResetOpen}
                title="Reset timeline?"
                message="This will restore all auto-detected zoom segments and remove manual edits."
                confirmLabel="Reset"
                danger
                onConfirm={performResetTimeline}
                onCancel={() => setConfirmResetOpen(false)}
            />

            <main className="editor-main">
                <div className="canvas-section" onClick={() => selectSegment(null)}>
                    <div className="canvas-container" ref={canvasContainerRef}>
                        <CanvasPlayer
                            ref={canvasPlayerRef}
                            recording={recording}
                            isPlaying={isPlaying}
                            currentTime={currentTime}
                            segments={segments}
                            zoomLevel={zoomLevel}
                            zoomDuration={zoomDuration}
                            transitionDuration={transitionDuration}
                            playbackSpeed={playbackSpeed}
                            aspectRatio={aspectRatio}
                            backgroundColor={backgroundColor}
                            backgroundMode={backgroundMode}
                            backgroundValue={backgroundValue}
                            backgroundBlur={backgroundBlur}
                            insetPadding={insetPadding}
                            cropToFill={cropToFill}
                            cropPanX={cropPanX}
                            cropPanY={cropPanY}
                            cropZoom={cropZoom}
                            showShadow={showShadow}
                            showBorder={showBorder}
                            borderRadius={borderRadius}
                            isMuted={isMuted}
                            volume={volume}
                            showFollowCursor={showFollowCursor}
                            cursorSmoothing={cursorSmoothing}
                            clickAnimationStyle={clickAnimationStyle}
                            clickAnimationOpacity={clickAnimationOpacity}
                            clickSound={clickSound}
                            captions={captions}
                            showCaptions={captionsEnabled}
                            captionStyle={captionStyle}
                            onTimeUpdate={handleTimeUpdate}
                            onPlaybackEnded={handlePlaybackEnded}
                            onFrameTime={handleFrameTime}
                            onDurationChange={handleDurationChange}
                            onVideoDimensions={handleVideoDimensions}
                            onSeek={handleSeek}
                        />

                        {showZoomOverlay && (
                            <ZoomTargetOverlay
                                frameRect={zoomFrameRect}
                                sceneLayout={zoomSceneLayout}
                                selectedSegment={selectedSegment}
                                onUpdateSegment={updateSegment}
                            />
                        )}

                        {showCropOverlay && (
                            <CropPanOverlay
                                frameRect={frameRect}
                                videoRect={videoRect}
                                onUpdatePan={updateCropPan}
                            />
                        )}
                    </div>
                </div>

                <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                    <div className="sidebar-tab-bar">
                        {!sidebarCollapsed && (
                            <Tabs tabs={sidebarTabs} activeId={sidebarTab} onChange={setSidebarTab} />
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            className="sidebar-collapse-btn"
                            onClick={() => setSidebarCollapsed((prev) => !prev)}
                            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                            icon={sidebarCollapsed ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
                        />
                    </div>

                    {!sidebarCollapsed && (
                        <div className="sidebar-content">
                            {sidebarTab === 'segment' && selectedSegment && (
                                <SegmentInspector
                                    segment={selectedSegment}
                                    segments={segments}
                                    updateSegment={updateSegment}
                                    saveHistory={saveHistory}
                                    tracks={tracks}
                                    onDeleteSegment={deleteSegment}
                                    onClose={() => selectSegment(null)}
                                />
                            )}
                            {sidebarTab === 'video' && (
                                <SidebarSettings
                                    zoomLevel={zoomLevel}
                                    setZoomLevel={setZoomLevel}
                                    zoomDuration={zoomDuration}
                                    setZoomDuration={setZoomDuration}
                                    transitionDuration={transitionDuration}
                                    setTransitionDuration={setTransitionDuration}
                                    autoZoomIntensity={autoZoomIntensity}
                                    setAutoZoomIntensity={setAutoZoomIntensity}
                                    regenerateAutoZoom={regenerateAutoZoom}
                                    setHasPendingEdits={setHasPendingEdits}
                                    playbackSpeed={playbackSpeed}
                                    setPlaybackSpeed={setPlaybackSpeed}
                                    cursorSmoothing={cursorSmoothing}
                                    setCursorSmoothing={setCursorSmoothing}
                                    clickAnimationStyle={clickAnimationStyle}
                                    setClickAnimationStyle={setClickAnimationStyle}
                                    clickAnimationOpacity={clickAnimationOpacity}
                                    setClickAnimationOpacity={setClickAnimationOpacity}
                                    clickSound={clickSound}
                                    setClickSound={setClickSound}
                                    clickAnimationInRecording={clickAnimationInRecording}
                                    setClickAnimationInRecording={setClickAnimationInRecording}
                                    trimStart={trimStart}
                                    trimEnd={trimEnd}
                                    duration={duration}
                                    currentTime={currentTime}
                                    setTrimStart={markTrimStart}
                                    setTrimEnd={markTrimEnd}
                                    onJumpToFrame={() => setSidebarTab('frame')}
                                    showFollowCursor={showFollowCursor}
                                    onOpenShortcuts={() => setShortcutsOpen(true)}
                                />
                            )}
                            {sidebarTab === 'frame' && (
                                <FramingPanel
                                    aspectRatio={aspectRatio}
                                    setAspectRatio={setAspectRatio}
                                    backgroundMode={backgroundMode}
                                    setBackgroundMode={setBackgroundMode}
                                    backgroundColor={backgroundColor}
                                    setBackgroundColor={setBackgroundColor}
                                    backgroundValue={backgroundValue}
                                    setBackgroundValue={setBackgroundValue}
                                    backgroundBlur={backgroundBlur}
                                    setBackgroundBlur={setBackgroundBlur}
                                    cropToFill={cropToFill}
                                    setCropToFill={setCropToFill}
                                    cropZoom={cropZoom}
                                    setCropZoom={setCropZoom}
                                    insetPadding={insetPadding}
                                    setInsetPadding={setInsetPadding}
                                    showShadow={showShadow}
                                    setShowShadow={setShowShadow}
                                    showBorder={showBorder}
                                    setShowBorder={setShowBorder}
                                    borderRadius={borderRadius}
                                    setBorderRadius={setBorderRadius}
                                    showFollowCursor={showFollowCursor}
                                    setShowFollowCursor={setShowFollowCursor}
                                    setHasPendingEdits={setHasPendingEdits}
                                />
                            )}
                            {sidebarTab === 'captions' && (
                                <CaptionsPanel
                                    recording={recording}
                                    captions={captions}
                                    captionsEnabled={captionsEnabled}
                                    setCaptionsEnabled={setCaptionsEnabled}
                                    burnInCaptions={burnInCaptions}
                                    setBurnInCaptions={setBurnInCaptions}
                                    addCaptionAtPlayhead={addCaptionAtPlayhead}
                                    updateCaption={updateCaption}
                                    deleteCaption={deleteCaption}
                                    setAllCaptions={setAllCaptions}
                                    duration={duration}
                                    trimStart={trimStart}
                                    trimEnd={trimEnd}
                                    onSeek={handleSeek}
                                    setHasPendingEdits={setHasPendingEdits}
                                    captionFontScale={captionFontScale}
                                    setCaptionFontScale={setCaptionFontScale}
                                    captionFontFamily={captionFontFamily}
                                    setCaptionFontFamily={setCaptionFontFamily}
                                    captionColor={captionColor}
                                    setCaptionColor={setCaptionColor}
                                    captionBackground={captionBackground}
                                    setCaptionBackground={setCaptionBackground}
                                    captionPosition={captionPosition}
                                    setCaptionPosition={setCaptionPosition}
                                />
                            )}
                        </div>
                    )}
                </aside>
            </main>

            <div className="timeline-section">
                <Timeline
                    duration={duration}
                    currentTime={currentTime}
                    registerPlayhead={registerPlayhead}
                    segments={segments}
                    tracks={tracks}
                    selectedSegmentId={selectedSegmentId}
                    trimStart={trimStart}
                    trimEnd={trimEnd || duration}
                    onSeek={handleSeek}
                    onAddSegment={addSegment}
                    onAddTrack={addTrack}
                    onRemoveTrack={removeTrack}
                    onUpdateSegment={updateSegment}
                    onSelectSegment={selectSegment}
                    onDeleteSegment={deleteSegment}
                    onResetTimeline={requestResetTimeline}
                    onTrimChange={handleTrimChange}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    captions={captionsEnabled ? captions : []}
                    onUpdateCaption={updateCaption}
                    onSelectCaption={(id) => { if (id) { setSidebarTab('captions'); setSidebarCollapsed(false); } }}
                />
            </div>

            <ExportPanel
                isPlaying={isPlaying}
                onPlayPause={handlePlayPause}
                onSkip={handleSkip}
                loopPlayback={loopPlayback}
                setLoopPlayback={setLoopPlayback}
                isMuted={isMuted}
                setIsMuted={setIsMuted}
                volume={volume}
                setVolume={setVolume}
                isExporting={isExporting}
                exportProgress={exportProgress}
                exportResolution={exportResolution}
                setExportResolution={setExportResolution}
                exportFps={exportFps}
                setExportFps={setExportFps}
                exportFormat={exportFormat}
                setExportFormat={setExportFormat}
                conversionService={conversionService}
                setConversionService={setConversionService}
                exportQuality={exportQuality}
                setExportQuality={setExportQuality}
                aspectRatio={aspectRatio}
                videoWidth={recording?.resolution?.width}
                videoHeight={recording?.resolution?.height}
                sourceFps={recording?.frameRate}
                duration={duration}
                trimStart={trimStart}
                trimEnd={trimEnd}
                onExport={handleExport}
            />
        </div>
    );
}

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(<Editor />);
}
