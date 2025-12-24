import { HexColorPicker } from "react-colorful";
import { useState } from "react";
import Ping from "./Ping";

interface Props {
  value?: string;
  onChange: (value: string) => void;
}

const ColorPicker = ({ value, onChange }: Props) => {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="color-picker relative">
      <Ping>
        <div
          className="h-6 w-6 rounded border border-slate-200 cursor-pointer"
          style={{ backgroundColor: value || "#ffffff" }}
          onClick={() => setShowPicker(!showPicker)}
        />
      </Ping>

      {showPicker && (
        <div className="absolute z-10 bottom-14">
          <div className="fixed inset-0" onClick={() => setShowPicker(false)} />
          <HexColorPicker color={value || "#ffffff"} onChange={onChange} />
        </div>
      )}

      <input
        type="text"
        placeholder="#000000"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="hex-input placeholder:font-normal placeholder:text-slate-500"
      />
    </div>
  );
};

export default ColorPicker;
