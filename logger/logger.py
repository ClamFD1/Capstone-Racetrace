import serial
import json
import time
import os
import argparse
import threading
import queue
import math
import numpy as np


LEVER_ARM_M = 1.19 #in metres how far forward the tag is on kart
FHDG_MIN_SPEED = 0.3


class KalmanFilter:
    def __init__(self, sigma_a=8.0, sigma_r=0.15, gate=6.0):
        self.sigma_a = sigma_a
        self.sigma_r = sigma_r
        self._gate2 = gate ** 2
        self.initialized = False

        self._H = np.array([[1., 0., 0., 0.],
                            [0., 1., 0., 0.]])
        self._R = np.eye(2) * sigma_r ** 2

        self.x = np.zeros(4)
        self.P = np.eye(4)

    def init(self, x, z):
        self.x = np.array([x, z, 0., 0.])
        self.P = np.diag([0.5**2, 0.5**2, 2.**2, 2.**2])
        self.initialized = True

    def predict(self, dt):
        dt = max(dt, 1e-3)
        F = np.array([[1., 0., dt, 0.],
                      [0., 1., 0., dt],
                      [0., 0., 1., 0.],
                      [0., 0., 0., 1.]])
        q = self.sigma_a ** 2
        Q = q * np.array([
            [dt**4 / 4., 0., dt**3 / 2., 0.],
            [0., dt**4 / 4., 0., dt**3 / 2.],
            [dt**3 / 2., 0., dt**2, 0.],
            [0., dt**3 / 2., 0., dt**2],
        ])
        self.x = F @ self.x
        self.P = F @ self.P @ F.T + Q

    def update(self, x, z, q_uwb=100):
        quality_scale = 1.0 + max(0., (60 - q_uwb)) / 20.0
        R = self._R * quality_scale

        y = np.array([x, z]) - self._H @ self.x
        S = self._H @ self.P @ self._H.T + R
        Sinv = np.linalg.inv(S)

        if float(y @ Sinv @ y) > self._gate2:
            return False

        K = self.P @ self._H.T @ Sinv
        self.x = self.x + K @ y
        self.P = (np.eye(4) - K @ self._H) @ self.P
        return True


def parse_pos(line):
    parts = line.strip().split(",")
    try:
        idx = parts.index("POS")
        x = float(parts[idx + 1])
        y = float(parts[idx + 2])
        z = float(parts[idx + 3])
        q = int(parts[idx + 4])
        return x, y, z, q
    except (ValueError, IndexError):
        return None



def parse_hdg(line):
    try:
        return float(line.strip())
    except ValueError:
        return None


def reader_thread(ser, q, stop_event, label=""):
    while not stop_event.is_set():
        try:
            raw = ser.readline().decode("ascii", errors="ignore")
            if raw:
                q.put((time.time(), raw))
        except serial.SerialException as e:
            print(f"\n[{label}] Serial error: {e}")
            stop_event.set()
            break


def main():
    parser = argparse.ArgumentParser(description="RaceTrace sensor logger")
    parser.add_argument("--port", default=None, help="UWB serial port (optional)")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--imu-port", default=None, help="XIAO BLE Sense heading port (optional)")
    parser.add_argument("--imu-baud", type=int, default=115200)
    args = parser.parse_args()

    bootfs = "/boot/firmware"
    if os.path.isdir(bootfs):
        sessions_dir = os.path.join(bootfs, "sessions")
    else:
        sessions_dir = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "data", "sessions"
        )
    os.makedirs(sessions_dir, exist_ok=True)

    session_ts = int(time.time())
    session_name = input("Session name: ").strip()
    if session_name:
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in session_name)
        session_path = os.path.join(sessions_dir, f"{safe_name}.jsonl")
    else:
        session_path = os.path.join(sessions_dir, f"{session_ts}.jsonl")

    if not args.port and not args.imu_port:
        print("no sensors plugged in")
        return

    print(f"RaceTrace Logger")
    print(f"UWB port: {args.port + ' @ ' + str(args.baud) + ' baud' if args.port else '(none)'}")
    print(f"IMU port: {args.imu_port + ' @ ' + str(args.imu_baud) + ' baud' if args.imu_port else '(none)'}")
    print(f"Output: {os.path.abspath(session_path)}")
    print(f"Press Ctrl+C to stop.\n")

    uwb_ser = None
    if args.port:
        try:
            uwb_ser = serial.Serial()
            uwb_ser.port = args.port
            uwb_ser.baudrate = args.baud
            uwb_ser.timeout = 1
            uwb_ser.rtscts = False
            uwb_ser.dsrdtr = False
            uwb_ser.dtr = False
            uwb_ser.rts = False
            uwb_ser.open()
            if hasattr(uwb_ser, 'set_buffer_size'):
                uwb_ser.set_buffer_size(rx_size=65536)

            uwb_ser.reset_input_buffer()
            for _ in range(3):
                uwb_ser.write(b'\r')
                time.sleep(0.5)
                uwb_ser.write(b'\r')
                time.sleep(0.5)
                pending = uwb_ser.read(uwb_ser.in_waiting or 1).decode("ascii", errors="ignore")
                if 'dwm>' in pending:
                    break
                time.sleep(0.5)

            uwb_ser.reset_input_buffer()
            uwb_ser.write(b'lec\r')
            time.sleep(0.5)
            test_line = uwb_ser.readline().decode("ascii", errors="ignore").strip()
            if test_line:
                print(f"  UWB init : OK ({test_line[:40]})")
            else:
                print(f"UWB no data")
        except serial.SerialException as e:
            print(f"ERROR: Could not open UWB port {args.port}: {e}")
            uwb_ser = None

    imu_ser = None
    if args.imu_port:
        try:
            imu_ser = serial.Serial(args.imu_port, args.imu_baud, timeout=1)
        except serial.SerialException as e:
            print(f"ERROR: Could not open IMU port {args.imu_port}: {e}")
            if uwb_ser:
                uwb_ser.close()
            return

    uwb_q = queue.Queue() if uwb_ser else None
    imu_q = queue.Queue() if imu_ser else None
    stop_event = threading.Event()

    uwb_thread = None
    if uwb_ser:
        uwb_thread = threading.Thread(
            target=reader_thread, args=(uwb_ser, uwb_q, stop_event, "UWB"), daemon=True
        )
        uwb_thread.start()

    if imu_ser:
        imu_thread = threading.Thread(
            target=reader_thread, args=(imu_ser, imu_q, stop_event, "IMU"), daemon=True
        )
        imu_thread.start()

    records_written = 0
    dropped_frames = 0
    last_uwb_t = None
    ukf = KalmanFilter()

    print(f"{'Timestamp':>16}  {'x':>8}  {'z':>8}  {'q':>4}  {'fx':>8}  {'fz':>8}  {'hdg':>7}  {'fhdg':>7}  {'flag':>6}")
    print("-" * 96)

    last_hdg = None
    hdg_tare = None

    try:
        with open(session_path, "w") as f:
            while not stop_event.is_set():
                got_any = False

                if uwb_q:
                    try:
                        ts, raw = uwb_q.get_nowait()
                        result = parse_pos(raw)
                        if result is not None:
                            x, _, z, qval = result

                            gap_flag = ""
                            dt = (ts - last_uwb_t) if last_uwb_t is not None else 0.1
                            if last_uwb_t is not None and dt > 0.2:
                                dropped_frames += 1
                                gap_flag = "DROP"
                            last_uwb_t = ts

                            outlier_flag = ""
                            if ukf.initialized:
                                ukf.predict(dt)
                                accepted = ukf.update(x, z, qval)
                                if not accepted:
                                    outlier_flag = "GATE"
                            else:
                                ukf.init(x, z)
                            fx, fz = ukf.x[0], ukf.x[1]
                            vx, vz = ukf.x[2], ukf.x[3]
                            speed = math.sqrt(vx * vx + vz * vz)
                            fhdg = round((math.atan2(vx, vz) * 180 / math.pi) % 360, 1) \
                                if speed >= FHDG_MIN_SPEED else None
                            if last_hdg is not None and LEVER_ARM_M != 0:
                                h_rad = math.radians(last_hdg)
                                fx -= LEVER_ARM_M * math.sin(h_rad)
                                fz -= LEVER_ARM_M * math.cos(h_rad)

                            record = {"t": ts, "type": "pos", "x": x, "y": 0, "z": z, "q": qval,
                                      "fx": round(fx, 4), "fz": round(fz, 4)}
                            if fhdg is not None:
                                record["fhdg"] = fhdg
                            f.write(json.dumps(record) + "\n")
                            f.flush()
                            records_written += 1

                            flag_str = outlier_flag or gap_flag
                            hdg_str  = f"{last_hdg:>7.1f}" if last_hdg is not None else "imu broken"
                            fhdg_str = f"{fhdg:>7.1f}"     if fhdg is not None       else "    ---"
                            print(f"{ts:>16.3f}  {x:>8.3f}  {z:>8.3f}  {qval:>4}  {fx:>8.3f}  {fz:>8.3f}  {hdg_str}  {fhdg_str}  {flag_str:>6}")
                        got_any = True
                    except queue.Empty:
                        pass

                if imu_q:
                    try:
                        ts, raw = imu_q.get_nowait()
                        hdg = parse_hdg(raw)
                        if hdg is not None:
                            if hdg_tare is None:
                                hdg_tare = hdg
                            last_hdg = (hdg - hdg_tare) % 360
                        got_any = True
                    except queue.Empty:
                        pass

                if not got_any:
                    time.sleep(0.002)

    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        if uwb_thread:
            uwb_thread.join(timeout=2)
        if uwb_ser:
            uwb_ser.close()
        if imu_ser:
            imu_ser.close()

    print(f"\nStopped. {records_written} pos records written, {dropped_frames} dropped frames detected.")
    print(f"Output: {os.path.abspath(session_path)}")


if __name__ == "__main__":
    main()
