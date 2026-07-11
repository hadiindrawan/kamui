import React from 'react';
import { createRoot } from 'react-dom/client';
import { Film, HardDrive } from 'lucide-react';
import CanvasPlayer from './components/CanvasPlayer.jsx';
import Timeline from './components/Timeline.jsx';
import EditorToolbar from './components/EditorToolbar.jsx';
import SidebarSettings from './components/SidebarSettings.jsx';
import SegmentInspector from './components/SegmentInspector.jsx';
import FramingPanel from './components/FramingPanel.jsx';
import ExportPanel from './components/ExportPanel.jsx';
import ZoomTargetOverlay from './components/ZoomTargetOverlay.jsx';
import CropPanOverlay from './components/CropPanOverlay.jsx';
import PresetManagerModal from './components/PresetManagerModal.jsx';
import AutoExportCountdown from './components/AutoExportCountdown.jsx';
import { useEditorState } from './hooks/useEditorState.js';
import { usePresets } from './hooks/usePresets.js';
import { ToastProvider } from '../../shared/components/Toast.jsx';
import './editor.css';

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
        trimStart, trimEnd, setTrimStart, setTrimEnd,
        segments, selectedSegmentId, setSelectedSegmentId, selectSegment, addSegment, updateSegment, deleteSegment,
        resetTimeline, handleUndo, handleRedo, saveHistory, handleTrimChange,
        tracks, addTrack, removeTrack,
        hasPendingEdits, setHasPendingEdits, handleSaveChanges,
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
                            Beunta Editor
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
                        <label htmlFor="file-upload" className="btn btn-primary" style={{ marginTop: '20px', cursor: 'pointer', display: 'inline-flex', padding: '10px 20px', background: 'var(--accent)', color: 'var(--on-accent)', borderRadius: '8px' }}>
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
            />

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

                <aside className="sidebar">
                    {selectedSegment ? (
                        <SegmentInspector
                            segment={selectedSegment}
                            segments={segments}
                            updateSegment={updateSegment}
                            saveHistory={saveHistory}
                            tracks={tracks}
                            onDeleteSegment={deleteSegment}
                        />
                    ) : (
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
                            setTrimStart={setTrimStart}
                            setTrimEnd={setTrimEnd}
                        />
                    )}
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
                    onResetTimeline={resetTimeline}
                    onTrimChange={handleTrimChange}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
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
